/**
 * The frame loop: advance the search a little, step the replay, redraw.
 *
 * The scheduling decision that matters is in `advanceSearch`. A generation of 24 four-second
 * trials costs roughly 300 ms on one core — about twenty frames — so running a whole
 * generation per frame, as the slice-3 plan originally assumed, would drop the page to
 * 3 fps. Instead the loop spends a fixed slice of each frame on evaluation and yields.
 * Workers arrive in slice 4 and make this unnecessary; until then it is the difference
 * between a page that animates and a page that hangs.
 */

import {
  completeGeneration,
  evaluatePending,
  pendingCount,
  type Evaluator,
  type GenerationSummary,
} from '@evolab/evolution';
import { recordGeneration, type RunState } from './state.ts';

/**
 * Milliseconds per frame given to evaluation.
 *
 * A 60 fps frame is 16.7 ms. Eight leaves room for the replay step and the redraw, and
 * because the budget is only checked *between* trials the real overshoot is up to one
 * trial — about 12 ms for a 4 s trial. Worth knowing before blaming the renderer for a
 * dropped frame.
 */
export const EVAL_BUDGET_MS = 8;

export interface SearchProgress {
  /** Trials run this frame. */
  readonly evaluations: number;
  /** Set when a generation completed on this frame. */
  readonly summary: GenerationSummary | null;
  /** Set when that generation produced a better champion. */
  readonly newChampion: boolean;
}

const IDLE: SearchProgress = { evaluations: 0, summary: null, newChampion: false };

/**
 * Do up to `budgetMs` of evolution work. Returns what happened, so the caller can respawn
 * the replay only when the champion actually changed.
 */
export function advanceSearch(
  state: RunState,
  evaluate: Evaluator,
  budgetMs = EVAL_BUDGET_MS,
): SearchProgress {
  if (!state.running) return IDLE;
  if (state.island.generation >= state.target) {
    state.running = false;
    return IDLE;
  }

  const started = performance.now();
  const deadline = started + budgetMs;
  const evaluations = evaluatePending(state.island, evaluate, () => performance.now() < deadline);

  // Generations are only completed once every individual has been scored, so a generation
  // may span several frames. Ranking a half-evaluated population would let unscored
  // individuals sit at fitness 0 and be selected against unfairly.
  let summary: GenerationSummary | null = null;
  let newChampion = false;
  if (pendingCount(state.island) === 0) {
    summary = completeGeneration(state.island, state.pendingEvaluations + evaluations);
    newChampion = recordGeneration(state, summary);
    state.pendingEvaluations = 0;
  } else {
    state.pendingEvaluations += evaluations;
  }

  state.elapsedMs += performance.now() - started;
  return { evaluations, summary, newChampion };
}

/** Generations per second, measured over evaluation time only. */
export function generationsPerSecond(state: RunState): number {
  if (state.elapsedMs <= 0 || state.history.length === 0) return 0;
  return state.history.length / (state.elapsedMs / 1000);
}

/** Trials per second, the number that actually scales with slice 4's workers. */
export function trialsPerSecond(state: RunState): number {
  if (state.elapsedMs <= 0) return 0;
  return state.trials / (state.elapsedMs / 1000);
}
