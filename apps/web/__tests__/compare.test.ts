import { describe, expect, it } from 'vitest';
import type { TrialResult } from '@evolab/evolution';
import {
  compareTrial, divergenceNote, TRIAL_TOLERANCE, type StoredTrial,
} from '../src/net/compare.ts';

const trial = (over: Partial<TrialResult> = {}): TrialResult => ({
  distance: 5.9394, uprightTime: 4, effort: 47.0321, fell: false, duration: 4,
  strideLength: 0.92, dutyFactor: 0.7992, ...over,
});

/** What a run record holds, matching the trial above. */
const stored: StoredTrial = {
  distance: 5.9394, uprightTime: 4, effort: 47.0321,
  strideLength: 0.92, dutyFactor: 0.7992, fell: false,
};

describe('compareTrial', () => {
  it('is silent when the recomputation reproduces the run', () => {
    expect(compareTrial(stored, trial())).toEqual([]);
  });

  it('tolerates the rounding that serialise.ts applies on the way out', () => {
    // Stored values are rounded to four decimals, so a difference at the fifth is that
    // rounding and nothing else.
    const rounded: StoredTrial = { ...stored, distance: 5.93944, dutyFactor: 0.79924 };
    expect(compareTrial(rounded, trial())).toEqual([]);
  });

  it('reports a difference larger than the tolerance', () => {
    const differences = compareTrial({ ...stored, distance: 5.8 }, trial());
    expect(differences).toHaveLength(1);
    expect(differences[0]!.field).toBe('distance');
    expect(differences[0]!.stored).toBe(5.8);
    expect(differences[0]!.recomputed).toBeCloseTo(5.9394, 4);
  });

  it('trips just above the tolerance and not just below it', () => {
    // Deliberately 0.9x and 1.1x rather than exactly 1x. Adding the tolerance to a float lands
    // fractionally either side of it — 5.9394 + 0.001 differs by 0.0010000000000003 — so a
    // test pinned to the exact boundary would be testing IEEE 754, not this function.
    const inside = { ...stored, distance: stored.distance! + TRIAL_TOLERANCE * 0.9 };
    const outside = { ...stored, distance: stored.distance! + TRIAL_TOLERANCE * 1.1 };
    expect(compareTrial(inside, trial())).toEqual([]);
    expect(compareTrial(outside, trial())).toHaveLength(1);
  });

  it('compares falling exactly, because it is not a matter of degree', () => {
    const differences = compareTrial({ ...stored, fell: true }, trial({ fell: false }));
    expect(differences).toHaveLength(1);
    expect(differences[0]!.field).toBe('fell');
  });

  it('skips a field the stored run does not carry', () => {
    // A run saved before a field existed has nothing to say about it, which is different from
    // disagreeing about it. Treating absent as zero would report every old run as diverged.
    expect(compareTrial({ distance: 5.9394 }, trial())).toEqual([]);
    expect(compareTrial({}, trial())).toEqual([]);
  });

  it('ignores a stored value that is not a number', () => {
    expect(compareTrial({ ...stored, distance: NaN }, trial())).toEqual([]);
  });

  it('reports every field that moved, not just the first', () => {
    const differences = compareTrial(stored, trial({ distance: 3, dutyFactor: 0.5, fell: true }));
    expect(differences.map((d) => d.field)).toEqual(['distance', 'dutyFactor', 'fell']);
  });
});

describe('divergenceNote', () => {
  it('says nothing when the run reproduced', () => {
    // Silence is the right answer for a match. A run that replays correctly should not
    // announce that it did.
    expect(divergenceNote([])).toBeNull();
  });

  it('leads with falling when that is what changed', () => {
    const note = divergenceNote(compareTrial({ ...stored, fell: true }, trial({ fell: false })))!;
    expect(note).toContain('fell when saved and no longer does');
    expect(note).toContain('re-simulation');
  });

  it('says so the other way round too', () => {
    const note = divergenceNote(compareTrial({ ...stored, fell: false }, trial({ fell: true })))!;
    expect(note).toContain('stayed up when saved and now falls');
  });

  it('names the field that moved furthest', () => {
    const note = divergenceNote(compareTrial(stored, trial({ distance: 2, dutyFactor: 0.79 })))!;
    expect(note).toContain('distance');
    expect(note).toContain('5.939');
    expect(note).toContain('2.000');
  });

  it('always says what the reader is actually looking at', () => {
    for (const differences of [
      compareTrial({ ...stored, fell: true }, trial()),
      compareTrial(stored, trial({ distance: 1 })),
    ]) {
      expect(divergenceNote(differences)).toContain('re-simulation');
    }
  });
});

describe('per-field tolerance', () => {
  it('allows effort the precision it is actually stored at', () => {
    // serialise.ts rounds effort to one decimal and everything else to four. A flat
    // thousandth could never be satisfied for effort, so every run would report as diverged
    // for ever — which is what a freshly saved run did, at 62.500 against 62.534.
    expect(compareTrial({ ...stored, effort: 62.5 }, trial({ effort: 62.534 }))).toEqual([]);
  });

  it('still catches an effort change larger than that rounding', () => {
    const differences = compareTrial({ ...stored, effort: 62.5 }, trial({ effort: 66 }));
    expect(differences.map((d) => d.field)).toEqual(['effort']);
  });

  it('does not loosen the other fields', () => {
    expect(compareTrial({ ...stored, distance: stored.distance! + 0.02 }, trial())).toHaveLength(1);
  });
});
