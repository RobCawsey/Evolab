/**
 * A finished run, as it crosses the wire — slice 12.
 *
 * Pure, and takes everything explicitly rather than reaching for `state`, so it tests in Node
 * like `check.ts` and `bodies.ts`. Nothing here re-runs anything: every number was produced
 * by the search and is being copied, not recomputed.
 */

import type { Archive } from '@evolab/evolution';
import type { HistoryPoint } from '../run/state.ts';

export interface RunPayloadInput {
  readonly title: string;
  readonly seed: number;
  readonly generations: number;
  readonly population: number;
  readonly trialSeconds: number;
  readonly workers: number;
  readonly goalKey: string;
  readonly objective: {
    readonly distance: number;
    readonly upright: number;
    readonly effort: number;
    readonly effortBudget: number;
  };
  readonly bodySpec: string;
  readonly championGenome: string;
  readonly championFitness: number;
  readonly champion: {
    readonly distance: number;
    readonly uprightTime: number;
    readonly effort: number;
    readonly fell: boolean;
    readonly strideLength: number;
    readonly dutyFactor: number;
  };
  readonly archive: Archive | null;
  readonly history: readonly HistoryPoint[];
  readonly trajectoryHash?: string;
}

/** Rounded before it leaves. Sixteen significant figures of a Float32 is noise on a wire. */
const round = (value: number, places = 4): number =>
  Number.isFinite(value) ? Number(value.toFixed(places)) : 0;

/**
 * Build the body for `POST /api/runs`.
 *
 * **The objective weights are sent as numbers, not just the preset key.** Presets are copy
 * and copy gets reworded; a stored run must always be able to say what it was actually scored
 * on, not what a preset of that name means today. The same rule as `IslandConfig.trialSeed`
 * in slice 2 — if a score survives, the conditions it was scored under must not change.
 */
export function runPayload(input: RunPayloadInput): Record<string, unknown> {
  return {
    title: input.title.trim().slice(0, 120),
    seed: input.seed,
    generations: input.generations,
    population: input.population,
    trialSeconds: input.trialSeconds,
    workers: input.workers,

    goalKey: input.goalKey,
    goalDistance: input.objective.distance,
    goalUpright: input.objective.upright,
    goalEffort: input.objective.effort,
    // The naive preset uses MAX_SAFE_INTEGER for "no budget at all", which is not something
    // to put in a database column. Clamped to a number that means the same thing.
    goalEffortBudget: Math.min(input.objective.effortBudget, 1e9),

    bodySpec: input.bodySpec,
    championGenome: input.championGenome,
    championFitness: round(input.championFitness),
    championDistance: round(input.champion.distance),
    championUpright: round(input.champion.uprightTime),
    championEffort: round(input.champion.effort, 1),
    championFell: input.champion.fell,
    championStride: round(input.champion.strideLength),
    championDuty: round(input.champion.dutyFactor),
    ...(input.trajectoryHash === undefined ? {} : { trajectoryHash: input.trajectoryHash }),

    // Filled cells only. An empty cell is the absence of a behaviour, not a behaviour, and
    // sending 576 nulls would triple the payload to say nothing.
    archive: archiveCells(input.archive),
    history: input.history.map((point) => ({
      generation: point.generation,
      best: round(point.best),
      mean: round(point.mean),
      diversity: round(point.diversity),
    })),
  };
}

function archiveCells(archive: Archive | null): Array<Record<string, unknown>> {
  if (archive === null) return [];
  const cells: Array<Record<string, unknown>> = [];
  for (let index = 0; index < archive.cells.length; index++) {
    const cell = archive.cells[index];
    if (!cell) continue;
    cells.push({
      index,
      fitness: round(cell.fitness),
      stride: round(cell.behaviour[0]),
      duty: round(cell.behaviour[1]),
      genes: [...cell.genes].map((g) => round(g, 6)).join(','),
    });
  }
  return cells;
}

/** A default title, so saving never blocks on a text field the reader did not ask for. */
export function defaultTitle(goalName: string, distance: number, at = new Date()): string {
  const when = at.toISOString().slice(0, 16).replace('T', ' ');
  return `${goalName} — ${distance.toFixed(1)} m — ${when}`;
}
