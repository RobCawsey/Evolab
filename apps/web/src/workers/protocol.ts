/**
 * The message protocol between the main thread and the island workers.
 *
 * Raw `postMessage` with a discriminated union. Comlink would turn this into typed method
 * calls, but the protocol is six messages wide and the one thing that genuinely needs care
 * — which buffers get transferred — is exactly what an RPC wrapper hides.
 *
 * Every genome payload is a `Float32Array` and is **transferred**, not copied. A transferred
 * `ArrayBuffer` is detached on the sending side, so senders must hand over a copy they no
 * longer need. `emigrants()` in `packages/evolution` already returns copies for this reason.
 */

import { archiveInsert, type Archive, type GenerationSummary, type IslandConfig, type Morphology } from '@evolab/evolution';

/**
 * Cells of an island's behaviour archive that changed since the last report.
 *
 * Sent as four parallel typed arrays rather than an array of objects because the whole
 * point is that they transfer. A generation typically changes single-figure numbers of
 * cells, so this is a few hundred bytes; sending the whole 576-cell map every generation
 * would be structured-cloned and would cost more than the search.
 */
export interface ArchiveDelta {
  /** Flat cell indices, row-major with duty as the row. */
  readonly index: Int32Array;
  /** Fitness of each changed cell, parallel to `index`. */
  readonly fitness: Float32Array;
  /** Stride and duty of each changed cell — two entries per index. */
  readonly behaviour: Float32Array;
  /** The genome in each changed cell — `genomeLength` entries per index. */
  readonly genes: Float32Array;
  readonly genomeLength: number;
  /** Generation each cell was claimed or improved. */
  readonly generation: Int32Array;
}

/** Everything a worker needs to build its island. Structured-cloneable. */
export interface IslandSetup {
  readonly islandId: number;
  readonly morphology: Morphology;
  readonly seed: number;
  readonly config: Partial<IslandConfig>;
  readonly trialSeconds: number;
  /** Generations between sending migrants. Zero disables migration entirely. */
  readonly migrationInterval: number;
  readonly migrantCount: number;
}

export type ToWorker =
  | { readonly type: 'init'; readonly setup: IslandSetup }
  | { readonly type: 'run'; readonly untilGeneration: number }
  | { readonly type: 'pause' }
  | { readonly type: 'immigrate'; readonly genomes: readonly Float32Array[] };

export type FromWorker =
  | { readonly type: 'ready'; readonly islandId: number; readonly initMs: number }
  | {
      readonly type: 'generation';
      readonly islandId: number;
      readonly summary: GenerationSummary;
      /** Wall-clock milliseconds this island spent evaluating this generation. */
      readonly evalMs: number;
      /** Cells of this island's map that changed while running this generation. */
      readonly archive: ArchiveDelta;
    }
  | { readonly type: 'emigrants'; readonly islandId: number; readonly genomes: readonly Float32Array[] }
  | { readonly type: 'paused'; readonly islandId: number; readonly generation: number }
  | { readonly type: 'error'; readonly islandId: number; readonly message: string };

/** Buffers to hand to `postMessage`'s transfer list for a genome payload. */
export function transferable(genomes: readonly Float32Array[]): Transferable[] {
  return genomes.map((g) => g.buffer as ArrayBuffer);
}

/**
 * Collect the cells of `archive` whose fitness differs from `shadow`, and update `shadow`.
 *
 * The shadow is a plain `Float32Array` of the last-reported fitness per cell, seeded with
 * NaN so that the first report of a cell always differs — NaN !== NaN, which is the one
 * time that behaviour is convenient. Comparing fitness rather than identity is enough:
 * ties lose on insert, so a cell whose fitness has not moved has not changed.
 */
export function packArchiveDelta(
  archive: Archive,
  shadow: Float32Array,
  genomeLength: number,
): ArchiveDelta {
  const changed: number[] = [];
  for (let i = 0; i < archive.cells.length; i++) {
    const cell = archive.cells[i];
    if (cell === undefined || cell === null) continue;
    if (shadow[i] !== cell.fitness) {
      changed.push(i);
      shadow[i] = cell.fitness;
    }
  }

  const delta: ArchiveDelta = {
    index: new Int32Array(changed.length),
    fitness: new Float32Array(changed.length),
    behaviour: new Float32Array(changed.length * 2),
    genes: new Float32Array(changed.length * genomeLength),
    generation: new Int32Array(changed.length),
    genomeLength,
  };

  for (let k = 0; k < changed.length; k++) {
    const i = changed[k]!;
    const cell = archive.cells[i]!;
    delta.index[k] = i;
    delta.fitness[k] = cell.fitness;
    delta.behaviour[k * 2] = cell.behaviour[0];
    delta.behaviour[k * 2 + 1] = cell.behaviour[1];
    delta.generation[k] = cell.generation;
    delta.genes.set(cell.genes, k * genomeLength);
  }
  return delta;
}

export function archiveTransferable(delta: ArchiveDelta): Transferable[] {
  return [
    delta.index.buffer as ArrayBuffer,
    delta.fitness.buffer as ArrayBuffer,
    delta.behaviour.buffer as ArrayBuffer,
    delta.genes.buffer as ArrayBuffer,
    delta.generation.buffer as ArrayBuffer,
  ];
}

/**
 * Fold a delta into the main thread's combined map. Returns how many cells improved.
 *
 * Goes through `archiveInsert` rather than writing cells directly, so the displayed map
 * resolves a collision between two islands under exactly the rule each island used on
 * itself. Islands are independent searches and routinely find the same cell, so this is the
 * normal case rather than an edge one.
 */
export function applyArchiveDelta(target: Archive, delta: ArchiveDelta): number {
  const n = delta.genomeLength;
  let improved = 0;
  for (let k = 0; k < delta.index.length; k++) {
    const genes = delta.genes.subarray(k * n, k * n + n);
    const behaviour: [number, number] = [delta.behaviour[k * 2]!, delta.behaviour[k * 2 + 1]!];
    if (archiveInsert(target, genes, behaviour, delta.fitness[k]!, delta.generation[k]!)) {
      improved++;
    }
  }
  return improved;
}
