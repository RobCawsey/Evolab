/**
 * Everything the page knows about the current search, in one plain object.
 *
 * As of slice 4 the search itself lives in workers; this holds the aggregated view of it.
 * No state library — Zustand arrives around slice 6, when several panels need to share
 * state and prop-drilling starts to hurt.
 */

import {
  decodeGenome,
  defaultGait,
  encodeGenome,
  type GaitParams,
  type GenerationSummary,
  type Genome,
  type Morphology,
} from '@evolab/evolution';
import { IslandPool, defaultWorkerCount, type PoolEvents } from '../workers/pool.ts';
import { DEFAULT_PRESET, type Preset } from './objectives.ts';

/** Which gait the stage replays. 'first' is generation 0's best — the before picture. */
export type Mode = 'manual' | 'evolved' | 'first';

export type AppStage = 'guided' | 'explorer' | 'lab';

/** One point on the fitness chart: the ring aggregated at a generation boundary. */
export interface HistoryPoint {
  readonly generation: number;
  readonly best: number;
  readonly mean: number;
  readonly worst: number;
  readonly diversity: number;
}

export interface RunState {
  pool: IslandPool | null;
  history: HistoryPoint[];
  champion: { genes: Genome; fitness: number; params: GaitParams; summary: GenerationSummary } | null;
  running: boolean;
  target: number;
  seed: number;
  trialSeconds: number;
  population: number;
  workers: number;
  mode: Mode;
  manualGait: GaitParams;
  /** guided / explorer / lab. Freely switchable, nothing locked — section 7. */
  stage: AppStage;
  preset: Preset;
  /**
   * Best of generation 0, kept for the before-and-after in guided step 4.
   *
   * Captured separately from champion because champion is overwritten the moment anything
   * beats it, and the whole point of step 4 is having the first attempt to compare against.
   */
  firstChampion: { genes: Genome; fitness: number; params: GaitParams; summary: GenerationSummary } | null;
  /** Generation of the slowest island at the last history sample. */
  lastRecorded: number;
  startedAt: number;
  elapsedMs: number;
}

export interface RunOptions {
  seed?: number;
  target?: number;
  trialSeconds?: number;
  population?: number;
  workers?: number;
  manualGait?: GaitParams;
  mode?: Mode;
  stage?: AppStage;
  preset?: Preset;
}

export function createRunState(opts: RunOptions = {}): RunState {
  return {
    pool: null,
    history: [],
    champion: null,
    running: false,
    target: opts.target ?? 40,
    seed: opts.seed ?? 4417,
    trialSeconds: opts.trialSeconds ?? 4,
    population: opts.population ?? 24,
    workers: opts.workers ?? defaultWorkerCount(),
    mode: opts.mode ?? 'manual',
    stage: opts.stage ?? 'guided',
    preset: opts.preset ?? DEFAULT_PRESET,
    firstChampion: null,
    manualGait: opts.manualGait ?? defaultGait(),
    lastRecorded: -1,
    startedAt: 0,
    elapsedMs: 0,
  };
}

/**
 * Build a fresh pool. Workers initialise in parallel — each pays roughly 40 ms to bring up
 * its own Rapier instance, and doing that at start-up rather than on the first Run keeps
 * the button honest.
 */
export function spawnPool(
  state: RunState,
  morphology: Morphology,
  events: PoolEvents = {},
): IslandPool {
  state.pool?.dispose();
  const pool = new IslandPool(
    {
      morphology,
      seed: state.seed,
      workers: state.workers,
      trialSeconds: state.trialSeconds,
      config: {
        size: state.population,
        trialSeconds: state.trialSeconds,
        objective: state.preset.objective,
      },
    },
    events,
  );
  state.pool = pool;
  state.history = [];
  state.champion = null;
  state.firstChampion = null;
  state.running = false;
  state.lastRecorded = -1;
  state.startedAt = 0;
  state.elapsedMs = 0;
  return pool;
}

/** Best of generation 0 — the "before" half of guided step 4. */
export function offerFirst(state: RunState, summary: GenerationSummary): void {
  if (summary.generation !== 0) return;
  if (state.firstChampion !== null && summary.best <= state.firstChampion.fitness) return;
  state.firstChampion = {
    genes: summary.bestGenome,
    fitness: summary.best,
    params: decodeGenome(summary.bestGenome),
    summary,
  };
}

/**
 * Promote a summary to champion if it beats the incumbent.
 *
 * Elitism makes each island's own best monotonic, but across islands it is not — island 3
 * reporting generation 9 after island 1 reported generation 12 is normal. So this compares
 * rather than assuming.
 */
export function offerChampion(state: RunState, summary: GenerationSummary): boolean {
  if (state.champion !== null && summary.best <= state.champion.fitness) return false;
  state.champion = {
    genes: summary.bestGenome,
    fitness: summary.best,
    params: decodeGenome(summary.bestGenome),
    summary,
  };
  return true;
}

/** Sample the ring into the chart when the slowest island crosses a generation boundary. */
export function sampleHistory(state: RunState): boolean {
  const pool = state.pool;
  if (!pool) return false;
  const generation = pool.generation;
  if (!Number.isFinite(generation) || generation <= state.lastRecorded) return false;
  state.lastRecorded = generation;
  state.history.push({
    generation,
    best: pool.best,
    mean: pool.mean,
    // The ring has no single worst; the weakest island mean is the honest floor for a band
    // that is meant to show the population spreading rather than a precise minimum.
    worst: pool.islands.reduce((m, i) => Math.min(m, i.mean), Infinity) || 0,
    diversity: pool.meanDiversity,
  });
  return true;
}

/** The gait the stage should be replaying right now. */
export function activeGait(state: RunState): GaitParams {
  if (state.mode === 'first' && state.firstChampion) return state.firstChampion.params;
  if (state.mode === 'evolved' && state.champion) return state.champion.params;
  return state.manualGait;
}

/** Copy the champion into the sliders, so it can be poked at by hand. */
export function adoptChampion(state: RunState): GaitParams | null {
  if (!state.champion) return null;
  state.manualGait = state.champion.params;
  return state.manualGait;
}

/** Round-trip a hand-tuned gait into genome space, for seeding or for the URL. */
export function manualGenome(state: RunState): Genome {
  return encodeGenome(state.manualGait);
}
