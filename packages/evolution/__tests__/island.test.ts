import { describe, expect, it } from 'vitest';
import {
  completeGeneration,
  createIsland,
  evaluatePending,
  pendingCount,
  stepGeneration,
  type Genome,
  type TrialResult,
} from '@evolab/evolution';

/** Deterministic, closed-form, no physics — same shape as the golden test's evaluator. */
function fakeEvaluate(genome: Genome, seed: number): TrialResult {
  let peaks = 0;
  for (let i = 0; i < genome.length; i++) {
    peaks += Math.sin((i + 1) * genome[i]! * Math.PI) * (1 - i / (genome.length * 2));
  }
  const uprightTime = 4 * (0.5 + 0.5 * Math.cos(genome[0]! * Math.PI));
  return {
    distance: (peaks / genome.length) * 4,
    uprightTime,
    effort: 60 + 40 * genome[1]! + seed * 0.01,
    fell: uprightTime < 3.9,
    duration: uprightTime,
  };
}

describe('incremental evaluation', () => {
  it('produces exactly the same run as stepGeneration', () => {
    // The guarantee slice 3 depends on. The browser evaluates a few individuals per frame
    // and completes the generation when the last one lands; the CLI does the whole thing
    // in one call. If those two ever diverge, a run watched in the UI would not be the run
    // the CLI reproduces, and the golden test would only be guarding one of them.
    const whole = createIsland(0, 4417);
    const sliced = createIsland(0, 4417);

    for (let g = 0; g < 12; g++) {
      const a = stepGeneration(whole, fakeEvaluate);

      // Drip-feed: one individual at a time, mimicking a very tight frame budget.
      let evaluated = 0;
      while (pendingCount(sliced) > 0) {
        let done = false;
        evaluated += evaluatePending(sliced, fakeEvaluate, () => {
          if (done) return false;
          done = true;
          return true;
        });
      }
      const b = completeGeneration(sliced, evaluated);

      expect(b.generation).toBe(a.generation);
      expect(b.best).toBe(a.best);
      expect(b.mean).toBe(a.mean);
      expect(b.worst).toBe(a.worst);
      expect(b.diversity).toBe(a.diversity);
      expect(b.evaluations).toBe(a.evaluations);
      expect(Array.from(b.bestGenome)).toEqual(Array.from(a.bestGenome));
    }
  });

  it('evaluates at least one individual even with an exhausted budget', () => {
    // A budget check that can starve would leave the generation pending for ever and the
    // page would sit at generation 0 looking broken.
    const island = createIsland(0, 1);
    expect(evaluatePending(island, fakeEvaluate, () => false)).toBe(1);
  });

  it('reports pending work accurately', () => {
    const island = createIsland(0, 1, { size: 10 });
    expect(pendingCount(island)).toBe(10);
    evaluatePending(island, fakeEvaluate, () => false);
    expect(pendingCount(island)).toBe(9);
    evaluatePending(island, fakeEvaluate);
    expect(pendingCount(island)).toBe(0);
  });

  it('leaves elites pending-free in the next generation', () => {
    // Elites keep their result, so a fresh generation of 24 has only 22 trials to run.
    const island = createIsland(0, 1, { size: 24, elites: 2 });
    stepGeneration(island, fakeEvaluate);
    expect(pendingCount(island)).toBe(22);
  });

  it('is a no-op once everything is scored', () => {
    const island = createIsland(0, 1);
    evaluatePending(island, fakeEvaluate);
    expect(evaluatePending(island, fakeEvaluate)).toBe(0);
  });
});
