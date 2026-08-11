import { describe, expect, it } from 'vitest';
import {
  archiveBest,
  archiveCoverage,
  archiveIndex,
  archiveInsert,
  archiveMerge,
  archiveQd,
  behaviourOf,
  binOf,
  createArchive,
  createIsland,
  evaluatePending,
  stepGeneration,
  DEFAULT_DUTY_AXIS,
  DEFAULT_STRIDE_AXIS,
  type Genome,
  type TrialResult,
} from '../src/index.ts';

function trial(over: Partial<TrialResult> = {}): TrialResult {
  return {
    distance: 3, uprightTime: 4, effort: 50, fell: false, duration: 4,
    strideLength: 0.7, dutyFactor: 0.8,
    ...over,
  };
}

const g = (...v: number[]): Genome => Float32Array.from(v);

describe('binning', () => {
  it('spreads the range evenly and includes both ends', () => {
    const axis = { name: 'x', unit: '', min: 0, max: 1, bins: 10 };
    expect(binOf(axis, 0)).toBe(0);
    expect(binOf(axis, 0.05)).toBe(0);
    expect(binOf(axis, 0.5)).toBe(5);
    // The top edge belongs to the last bin, not to a nonexistent eleventh one.
    expect(binOf(axis, 1)).toBe(9);
  });

  it('clamps rather than dropping out-of-range behaviour', () => {
    // A gait outside the map is still a gait. Silently discarding it would make coverage
    // look worse than it is and would hide exactly the outliers worth looking at.
    const axis = { name: 'x', unit: '', min: 0, max: 1, bins: 10 };
    expect(binOf(axis, -5)).toBe(0);
    expect(binOf(axis, 99)).toBe(9);
    expect(binOf(axis, NaN)).toBe(0);
  });

  it('indexes row-major with duty as the row', () => {
    const a = createArchive();
    const col = binOf(DEFAULT_STRIDE_AXIS, 0.7);
    const row = binOf(DEFAULT_DUTY_AXIS, 0.8);
    expect(archiveIndex(a, [0.7, 0.8])).toBe(row * DEFAULT_STRIDE_AXIS.bins + col);
  });
});

describe('insertion', () => {
  it('starts empty and claims a cell on the first offer', () => {
    const a = createArchive();
    expect(a.cells).toHaveLength(576);
    expect(a.filled).toBe(0);
    expect(archiveCoverage(a)).toBe(0);

    expect(archiveInsert(a, g(1, 2), [0.7, 0.8], 5)).toBe(true);
    expect(a.filled).toBe(1);
    expect(a.attempts).toBe(1);
    expect(a.improvements).toBe(1);
  });

  it('keeps the fitter genome and does not double-count the cell', () => {
    const a = createArchive();
    archiveInsert(a, g(1), [0.7, 0.8], 5);

    expect(archiveInsert(a, g(2), [0.7, 0.8], 3)).toBe(false);
    expect(a.cells[archiveIndex(a, [0.7, 0.8])]!.fitness).toBe(5);

    expect(archiveInsert(a, g(3), [0.7, 0.8], 9)).toBe(true);
    expect(a.cells[archiveIndex(a, [0.7, 0.8])]!.fitness).toBe(9);
    // Improved, not newly claimed.
    expect(a.filled).toBe(1);
    expect(a.improvements).toBe(2);
  });

  it('lets ties lose, so a settled cell stops churning', () => {
    const a = createArchive();
    archiveInsert(a, g(1), [0.7, 0.8], 5, 3);
    expect(archiveInsert(a, g(2), [0.7, 0.8], 5, 9)).toBe(false);
    expect(a.cells[archiveIndex(a, [0.7, 0.8])]!.generation).toBe(3);
  });

  it('copies the genome instead of holding a reference to a live one', () => {
    // Regression guard. The population reuses its Float32Arrays between generations, so an
    // archive that stored the reference would quietly rewrite its own history and every
    // cell would end up describing the current population rather than the search.
    const a = createArchive();
    const live = g(1, 2, 3);
    archiveInsert(a, live, [0.7, 0.8], 5);
    live[0] = 99;
    expect(a.cells[archiveIndex(a, [0.7, 0.8])]!.genes[0]).toBe(1);
  });
});

describe('summaries', () => {
  it('reports coverage, quality-diversity and the single best cell', () => {
    const a = createArchive();
    archiveInsert(a, g(1), [0.1, 0.6], 2);
    archiveInsert(a, g(2), [0.9, 0.9], 7);
    archiveInsert(a, g(3), [1.2, 0.7], 4);

    expect(a.filled).toBe(3);
    expect(archiveCoverage(a)).toBeCloseTo(3 / 576, 12);
    expect(archiveQd(a)).toBeCloseTo(13, 12);
    expect(archiveBest(a)!.fitness).toBe(7);
  });

  it('has no best cell when nothing has been offered', () => {
    expect(archiveBest(createArchive())).toBeNull();
  });
});

describe('merging', () => {
  it('folds one map into another under the same rule as a direct insert', () => {
    const a = createArchive();
    const b = createArchive();
    archiveInsert(a, g(1), [0.7, 0.8], 5);
    archiveInsert(a, g(2), [0.2, 0.6], 1);
    archiveInsert(b, g(3), [0.7, 0.8], 9);   // beats a's incumbent
    archiveInsert(b, g(4), [1.1, 0.95], 6);  // a cell a has never reached

    expect(archiveMerge(a, b)).toBe(2);
    expect(a.filled).toBe(3);
    expect(a.cells[archiveIndex(a, [0.7, 0.8])]!.fitness).toBe(9);
    expect(a.cells[archiveIndex(a, [0.2, 0.6])]!.fitness).toBe(1);
  });

  it('is idempotent — merging the same map twice changes nothing', () => {
    // Workers re-send cells after a migration, so this happens in normal operation.
    const a = createArchive();
    const b = createArchive();
    archiveInsert(b, g(1), [0.7, 0.8], 5);
    archiveMerge(a, b);
    expect(archiveMerge(a, b)).toBe(0);
    expect(a.filled).toBe(1);
  });
});

describe('what counts as a behaviour', () => {
  it('rejects a trial that fell', () => {
    // A robot that toppled at 0.4 s has descriptors that describe the topple. Letting them
    // in fills the map with noise no later genome can displace.
    expect(behaviourOf(trial({ fell: true }))).toBeNull();
    expect(behaviourOf(trial())).toEqual([0.7, 0.8]);
  });

  it('rejects non-finite descriptors', () => {
    expect(behaviourOf(trial({ strideLength: NaN }))).toBeNull();
    expect(behaviourOf(trial({ dutyFactor: Infinity }))).toBeNull();
  });
});

describe('the island fills its archive without steering the search', () => {
  const fakeEvaluate = (genome: Genome): TrialResult => {
    const uprightTime = 4 * (0.5 + 0.5 * Math.cos(genome[0]! * Math.PI));
    return {
      distance: genome[1]! * 4,
      uprightTime,
      effort: 60,
      fell: uprightTime < 3.9,
      duration: uprightTime,
      strideLength: 0.2 + genome[2]! * 1.0,
      dutyFactor: 0.55 + genome[3]! * 0.4,
    };
  };

  it('offers each trial exactly once and never re-offers a carried elite', () => {
    // Elites keep their result across generations and are not re-evaluated, so they must
    // not be re-offered either — an elite counted every generation would inflate `attempts`
    // and make the improvement rate read as far worse than it is.
    const island = createIsland(0, 4417);
    let evaluations = 0;
    for (let i = 0; i < 6; i++) evaluations += stepGeneration(island, fakeEvaluate).evaluations;

    const survived = island.archive.attempts;
    expect(survived).toBeGreaterThan(0);
    expect(survived).toBeLessThanOrEqual(evaluations);
    expect(island.archive.filled).toBeGreaterThan(1);
  });

  it('leaves the population bit-identical to a run whose archive is ignored', () => {
    // The archive observes the search; it must not be part of it. If anything here ever
    // fed back into selection, this test is what would catch it.
    const a = createIsland(0, 9001);
    const b = createIsland(0, 9001);
    let drained = 0;
    for (let i = 0; i < 5; i++) {
      stepGeneration(a, fakeEvaluate);
      stepGeneration(b, fakeEvaluate);
      // Drain b's archive between generations: if the search read it, b would diverge.
      drained += b.archive.filled;
      b.archive.cells.fill(null);
      b.archive.filled = 0;
    }
    expect([...a.population.map((i) => [...i.genes])])
      .toEqual([...b.population.map((i) => [...i.genes])]);
    // Both halves of the comparison have to be real: an archive that never filled would
    // make this pass for the wrong reason.
    expect(a.archive.filled).toBeGreaterThan(0);
    expect(drained).toBeGreaterThan(0);
  });

  it('records a behaviour during partial evaluation, not only at generation end', () => {
    const island = createIsland(0, 77);
    let calls = 0;
    evaluatePending(island, fakeEvaluate, () => ++calls < 3);
    expect(island.archive.attempts).toBeGreaterThan(0);
    expect(island.archive.attempts).toBeLessThan(island.config.size);
  });
});
