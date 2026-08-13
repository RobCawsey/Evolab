/**
 * Does a recomputed trial still match the one that was saved? — slice 16.
 *
 * A reopened run does not download its recording. The simulation is deterministic and the run
 * record already holds the genome, the body, the seed and the trial length, so the recording is
 * recomputed locally in about fifteen milliseconds.
 *
 * That is only honest if the recomputation reproduces what was stored, so this checks rather
 * than assumes. **The six champion fields in a saved run are a checksum on the physics** — they
 * cost nothing to compare, because the recomputation has to happen anyway, and a mismatch means
 * the simulation has changed since the run was saved.
 *
 * Which is exactly the divergence that uploading the trajectory would have hidden. Replaying
 * stored bytes always looks right; recomputing and comparing is what makes the change visible.
 *
 * The note it produces deliberately does **not** name a cause. A mismatch means the trial did
 * not reproduce, and there are two reasons it might not: the physics has changed, or the record
 * is too lossy to reproduce from. The second is real — runs saved before slice 16 stored the
 * gait at three decimals, which is not enough — so asserting the first would often be wrong.
 *
 * Pure, so it tests in Node without a browser or a physics world.
 */

import type { TrialResult } from '@evolab/evolution';

/**
 * How far apart two values may be before it counts as a difference.
 *
 * `serialise.ts` rounds to four decimals on the way out, so anything at or below a thousandth
 * is that rounding and nothing else. Anything above it is not.
 */
export const TRIAL_TOLERANCE = 1e-3;

/**
 * Effort is stored to **one** decimal, not four — see `serialise.ts`.
 *
 * A tolerance tighter than the stored precision can never be satisfied, so it would report
 * every run as diverged for ever. Half of the last stored digit is the most a value can have
 * moved purely by being written down. Found by reopening a freshly saved run and watching
 * effort alone report 62.500 against 62.534 while everything else reproduced exactly.
 */
const FIELD_TOLERANCE: Readonly<Record<string, number>> = { effort: 0.05 };

const toleranceFor = (field: string, base: number): number =>
  Math.max(base, FIELD_TOLERANCE[field] ?? 0);

/** What a saved run remembers about its champion's trial. All optional — old runs may lack some. */
export interface StoredTrial {
  readonly distance?: number;
  readonly uprightTime?: number;
  readonly effort?: number;
  readonly strideLength?: number;
  readonly dutyFactor?: number;
  readonly fell?: boolean;
}

export interface TrialDifference {
  readonly field: string;
  readonly stored: number | boolean;
  readonly recomputed: number | boolean;
}

/**
 * Fields where the recomputation disagrees with what was stored. Empty means it reproduced.
 *
 * A field the stored run does not carry is skipped rather than treated as zero — a run saved
 * before a field existed has nothing to say about it, which is different from disagreeing.
 */
export function compareTrial(
  stored: StoredTrial,
  recomputed: TrialResult,
  tolerance = TRIAL_TOLERANCE,
): readonly TrialDifference[] {
  const differences: TrialDifference[] = [];

  const numeric: readonly [string, number | undefined, number][] = [
    ['distance', stored.distance, recomputed.distance],
    ['uprightTime', stored.uprightTime, recomputed.uprightTime],
    ['effort', stored.effort, recomputed.effort],
    ['strideLength', stored.strideLength, recomputed.strideLength],
    ['dutyFactor', stored.dutyFactor, recomputed.dutyFactor],
  ];

  for (const [field, was, now] of numeric) {
    if (was === undefined || !Number.isFinite(was)) continue;
    if (Math.abs(was - now) > toleranceFor(field, tolerance)) {
      differences.push({ field, stored: was, recomputed: now });
    }
  }

  // Kept last and compared exactly, because it is the one that is not a matter of degree.
  if (stored.fell !== undefined && stored.fell !== recomputed.fell) {
    differences.push({ field: 'fell', stored: stored.fell, recomputed: recomputed.fell });
  }

  return differences;
}

/**
 * What to tell the reader, or null when the run reproduced and there is nothing to say.
 *
 * Silence is the right answer for a match: a run that replays correctly should not announce it.
 * A run that does not must say so, because otherwise it quietly shows a different robot from the
 * one whose numbers are printed beside it.
 */
export function divergenceNote(differences: readonly TrialDifference[]): string | null {
  if (differences.length === 0) return null;

  const fell = differences.find((d) => d.field === 'fell');
  if (fell) {
    return 'This run does not replay exactly — it '
      + (fell.stored === true ? 'fell when saved and no longer does' : 'stayed up when saved and now falls')
      + '. You are watching a re-simulation from the stored gait, not the run itself.';
  }

  const worst = differences.reduce((a, b) =>
    Math.abs(Number(b.stored) - Number(b.recomputed)) > Math.abs(Number(a.stored) - Number(a.recomputed)) ? b : a);
  return 'This run does not replay exactly — '
    + `${worst.field} was ${Number(worst.stored).toFixed(3)} and is now `
    + `${Number(worst.recomputed).toFixed(3)}. You are watching a re-simulation from the stored `
    + 'gait, not the run itself.';
}
