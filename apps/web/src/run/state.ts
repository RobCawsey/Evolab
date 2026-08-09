/**
 * Everything the page knows about the current search, in one plain object.
 *
 * No state library. Zustand arrives around slice 6, when several panels need to share
 * state and prop-drilling starts to hurt; until then a module-scoped object and a redraw
 * every frame is simpler and easier to reason about.
 */

import {
  createIsland,
  decodeGenome,
  defaultGait,
  encodeGenome,
  type GaitParams,
  type GenerationSummary,
  type Genome,
  type Island,
} from '@evolab/evolution';

export type Mode = 'manual' | 'evolved';

export interface RunState {
  island: Island;
  history: GenerationSummary[];
  champion: { genes: Genome; fitness: number; params: GaitParams } | null;
  running: boolean;
  target: number;
  seed: number;
  trialSeconds: number;
  population: number;
  /** Which gait the stage is showing: the sliders, or the best genome found. */
  mode: Mode;
  manualGait: GaitParams;
  /** Wall-clock milliseconds spent evaluating, for an honest trials/second readout. */
  elapsedMs: number;
  trials: number;
  /**
   * Trials run so far towards the generation currently in progress.
   *
   * A generation spans several frames, so the count has to survive between them —
   * otherwise the summary would report only the trials that happened to land on the frame
   * where the generation completed.
   */
  pendingEvaluations: number;
}

export interface RunOptions {
  seed?: number;
  target?: number;
  trialSeconds?: number;
  population?: number;
  manualGait?: GaitParams;
  mode?: Mode;
}

export function createRunState(opts: RunOptions = {}): RunState {
  const seed = opts.seed ?? 4417;
  const target = opts.target ?? 40;
  const trialSeconds = opts.trialSeconds ?? 4;
  const population = opts.population ?? 24;
  return {
    island: createIsland(0, seed, { size: population, trialSeconds }),
    history: [],
    champion: null,
    running: false,
    target,
    seed,
    trialSeconds,
    population,
    mode: opts.mode ?? 'manual',
    manualGait: opts.manualGait ?? defaultGait(),
    elapsedMs: 0,
    trials: 0,
    pendingEvaluations: 0,
  };
}

/** Throw away the search and start again with the current settings. */
export function resetRun(state: RunState): void {
  state.island = createIsland(0, state.seed, {
    size: state.population,
    trialSeconds: state.trialSeconds,
  });
  state.history = [];
  state.champion = null;
  state.running = false;
  state.elapsedMs = 0;
  state.trials = 0;
  state.pendingEvaluations = 0;
}

/**
 * Record a generation, promoting its best genome to champion if it improved.
 *
 * Elitism guarantees `best` never decreases, so the comparison is a formality — but it is
 * the formality that stops the replay being respawned every single generation when nothing
 * has actually changed.
 */
export function recordGeneration(state: RunState, summary: GenerationSummary): boolean {
  state.history.push(summary);
  state.trials += summary.evaluations;
  if (state.champion !== null && summary.best <= state.champion.fitness) return false;
  state.champion = {
    genes: summary.bestGenome,
    fitness: summary.best,
    params: decodeGenome(summary.bestGenome),
  };
  return true;
}

/** The gait the stage should be replaying right now. */
export function activeGait(state: RunState): GaitParams {
  return state.mode === 'evolved' && state.champion ? state.champion.params : state.manualGait;
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
