/**
 * The worker pool: spawn N islands, route migrants around the ring, aggregate what comes
 * back.
 *
 * The main thread is the postman, not the scheduler. It never decides when an island
 * should evolve — it forwards emigrants and collects summaries. That is what removes the
 * per-generation synchronisation barrier: no island ever waits for the slowest trial in
 * another island.
 */

import { createArchive, type Archive, type GenerationSummary, type IslandConfig, type Morphology } from '@evolab/evolution';
import type { FromWorker, IslandSetup, ToWorker } from './protocol.ts';
import { applyArchiveDelta, transferable } from './protocol.ts';

export interface PoolOptions {
  readonly morphology: Morphology;
  readonly seed: number;
  readonly workers: number;
  readonly trialSeconds: number;
  readonly config: Partial<IslandConfig>;
  readonly migrationInterval?: number;
  readonly migrantCount?: number;
}

export interface IslandState {
  readonly id: number;
  generation: number;
  best: number;
  mean: number;
  diversity: number;
  trials: number;
  evalMs: number;
  ready: boolean;
  migrantsIn: number;
  /** Set for one poll after a migrant arrival was followed by a jump in best fitness. */
  boosted: boolean;
}

export interface PoolEvents {
  onGeneration?: (islandId: number, summary: GenerationSummary) => void;
  onReady?: () => void;
  onError?: (islandId: number, message: string) => void;
}

/**
 * How many workers to spawn.
 *
 * One core is left for the UI thread, and touch devices are capped at four regardless —
 * a thermally throttled phone that has locked up is a broken app whoever's fault it is
 * (§10 of the design document).
 */
export function defaultWorkerCount(): number {
  const cores = navigator.hardwareConcurrency || 4;
  const touch = navigator.maxTouchPoints > 0;
  return Math.max(1, Math.min(cores - 1, touch ? 4 : 8));
}

export class IslandPool {
  readonly islands: IslandState[] = [];
  /**
   * Every island's map, folded into one.
   *
   * Deliberately a union rather than a per-island view. Islands are independent searches
   * with different seeds, and the interesting claim — that the population as a whole holds
   * a repertoire of gaits — is about the union. Per-island coverage would mostly show that
   * four small searches each cover less than one big one, which is true and not the point.
   */
  readonly archive: Archive = createArchive();
  /** Bumped whenever a cell changes, so the renderer can skip a repaint that would be identical. */
  archiveRevision = 0;
  private readonly workers: Worker[] = [];
  private readonly opts: PoolOptions;
  private readonly events: PoolEvents;
  private readonly migrationInterval: number;
  private readonly migrantCount: number;
  private readyCount = 0;
  private disposed = false;

  constructor(opts: PoolOptions, events: PoolEvents = {}) {
    this.opts = opts;
    this.events = events;
    this.migrationInterval = opts.migrationInterval ?? 5;
    this.migrantCount = opts.migrantCount ?? 2;

    for (let id = 0; id < opts.workers; id++) {
      const worker = new Worker(new URL('./island.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
      worker.onerror = (e) => this.events.onError?.(id, e.message);
      this.workers.push(worker);
      this.islands.push({
        id, generation: 0, best: 0, mean: 0, diversity: 0, trials: 0,
        evalMs: 0, ready: false, migrantsIn: 0, boosted: false,
      });

      // Islands are seeded distinctly, so they explore genuinely different regions rather
      // than running the same search N times.
      const setup: IslandSetup = {
        islandId: id,
        morphology: opts.morphology,
        seed: opts.seed + id * 7919,
        config: opts.config,
        trialSeconds: opts.trialSeconds,
        migrationInterval: opts.workers > 1 ? this.migrationInterval : 0,
        migrantCount: this.migrantCount,
      };
      this.send(id, { type: 'init', setup });
    }
  }

  private send(islandId: number, message: ToWorker, transfer?: Transferable[]): void {
    const worker = this.workers[islandId];
    if (!worker || this.disposed) return;
    if (transfer && transfer.length > 0) worker.postMessage(message, transfer);
    else worker.postMessage(message);
  }

  private receive(message: FromWorker): void {
    if (this.disposed) return;
    const island = this.islands[message.islandId];
    if (!island) return;

    switch (message.type) {
      case 'ready': {
        island.ready = true;
        if (++this.readyCount === this.workers.length) this.events.onReady?.();
        return;
      }

      case 'generation': {
        const before = island.best;
        island.generation = message.summary.generation + 1;
        island.best = message.summary.best;
        island.mean = message.summary.mean;
        island.diversity = message.summary.diversity;
        island.trials += message.summary.evaluations;
        island.evalMs += message.evalMs;
        // Migration is meant to be visible, not merely believed in. A jump in best fitness
        // within a couple of generations of an arrival is the observable effect.
        if (island.migrantsIn > 0 && message.summary.best > before + 1e-9) {
          island.boosted = true;
          island.migrantsIn = 0;
        }
        if (applyArchiveDelta(this.archive, message.archive) > 0) this.archiveRevision++;
        this.events.onGeneration?.(message.islandId, message.summary);
        return;
      }

      case 'emigrants': {
        // Ring topology: every island sends to the next, so genomes circulate rather than
        // all converging on one place.
        const to = (message.islandId + 1) % this.workers.length;
        if (to === message.islandId) return;
        this.islands[to]!.migrantsIn += message.genomes.length;
        this.send(to, { type: 'immigrate', genomes: message.genomes }, transferable(message.genomes));
        return;
      }

      case 'paused':
        return;

      case 'error': {
        this.events.onError?.(message.islandId, message.message);
        return;
      }
    }
  }

  get ready(): boolean {
    return this.readyCount === this.workers.length;
  }

  get workerCount(): number {
    return this.workers.length;
  }

  run(untilGeneration: number): void {
    for (let id = 0; id < this.workers.length; id++) {
      this.send(id, { type: 'run', untilGeneration });
    }
  }

  pause(): void {
    for (let id = 0; id < this.workers.length; id++) this.send(id, { type: 'pause' });
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
  }

  /* ---------------- aggregates ---------------- */

  /** Best across every island — the amber line on the chart. */
  get best(): number {
    return this.islands.reduce((m, i) => Math.max(m, i.best), 0);
  }

  /** Mean of island means. Not the true population mean, and close enough to read. */
  get mean(): number {
    if (this.islands.length === 0) return 0;
    return this.islands.reduce((s, i) => s + i.mean, 0) / this.islands.length;
  }

  get meanDiversity(): number {
    if (this.islands.length === 0) return 0;
    return this.islands.reduce((s, i) => s + i.diversity, 0) / this.islands.length;
  }

  /** Slowest island — the ring is only as far along as its laggard. */
  get generation(): number {
    return this.islands.reduce((m, i) => Math.min(m, i.generation), Infinity) || 0;
  }

  get trials(): number {
    return this.islands.reduce((s, i) => s + i.trials, 0);
  }

  /**
   * Total evaluation time across islands. Divided into `trials` this gives throughput per
   * core; the wall-clock speedup is that divided by the worker count.
   */
  get evalMs(): number {
    return this.islands.reduce((s, i) => s + i.evalMs, 0);
  }
}
