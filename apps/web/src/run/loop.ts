/**
 * Throughput readouts for the worker pool.
 *
 * Slice 3's `advanceSearch` lived here and did the evolving on the main thread, sliced
 * across frames. Slice 4 deletes it: the workers own the search now and the frame loop
 * only samples what they report. That is the whole benefit — the UI thread no longer does
 * any physics at all, so the frame budget stops being a constraint on the search.
 */

import type { RunState } from './state.ts';

/** Trials per second across the whole ring, measured against wall-clock run time. */
export function trialsPerSecond(state: RunState): number {
  if (state.elapsedMs <= 0 || !state.pool) return 0;
  return state.pool.trials / (state.elapsedMs / 1000);
}

/** Generations per second, taken from the slowest island so it is not flattering. */
export function generationsPerSecond(state: RunState): number {
  if (state.elapsedMs <= 0 || !state.pool) return 0;
  const generation = state.pool.generation;
  return Number.isFinite(generation) ? generation / (state.elapsedMs / 1000) : 0;
}

/**
 * Observed parallel speedup: core-time spent evaluating divided by wall-clock elapsed.
 *
 * A value near the worker count means the ring is genuinely running in parallel. Well
 * below it means workers are idling — waiting on migrants, or starved by a main thread
 * that is too busy to deliver messages.
 */
export function parallelSpeedup(state: RunState): number {
  if (state.elapsedMs <= 0 || !state.pool) return 0;
  return state.pool.evalMs / state.elapsedMs;
}
