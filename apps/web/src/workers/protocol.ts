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

import type { GenerationSummary, IslandConfig, Morphology } from '@evolab/evolution';

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
    }
  | { readonly type: 'emigrants'; readonly islandId: number; readonly genomes: readonly Float32Array[] }
  | { readonly type: 'paused'; readonly islandId: number; readonly generation: number }
  | { readonly type: 'error'; readonly islandId: number; readonly message: string };

/** Buffers to hand to `postMessage`'s transfer list for a genome payload. */
export function transferable(genomes: readonly Float32Array[]): Transferable[] {
  return genomes.map((g) => g.buffer as ArrayBuffer);
}
