import { describe, expect, it } from 'vitest';
import {
  completeGeneration,
  createIsland,
  evaluatePending,
  generation,
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
    // Synthetic behaviour descriptors. Nothing in score() reads them, so they cannot move
    // the golden numbers; they exist so the archive has something to spread across.
    strideLength: 0.5 + 0.4 * genome[2]!,
    dutyFactor: 0.4 + 0.5 * genome[3]!,
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

describe('generation as a generator', () => {
  it('produces the same run whether traced or not', () => {
    // The stepper watches a traced generation; the workers drain an untraced one. If
    // tracing perturbed the search by so much as one random draw, the algorithm on the
    // teaching screen would not be the algorithm that actually runs — which would make the
    // whole screen a lie.
    const plain = createIsland(0, 4417);
    const traced = createIsland(0, 4417);

    for (let g = 0; g < 10; g++) {
      const a = stepGeneration(plain, fakeEvaluate);

      const it = generation(traced, fakeEvaluate, { trace: true });
      let step = it.next();
      while (!step.done) step = it.next();
      const b = step.value;

      expect(b.best).toBe(a.best);
      expect(b.mean).toBe(a.mean);
      expect(b.diversity).toBe(a.diversity);
      expect(Array.from(b.bestGenome)).toEqual(Array.from(a.bestGenome));
    }
    expect(traced.population.map((i) => Array.from(i.genes)))
      .toEqual(plain.population.map((i) => Array.from(i.genes)));
  });

  it('yields nothing at all when not tracing', () => {
    // The fast path has to stay allocation-free. A stray yield here would cost the worker
    // an object per operator, millions of times per run.
    const island = createIsland(0, 1);
    const it = generation(island, fakeEvaluate);
    expect(it.next().done).toBe(true);
  });

  it('walks the operators in the order the algorithm applies them', () => {
    const island = createIsland(0, 4417, { size: 8, elites: 2 });
    const stages = [...generation(island, fakeEvaluate, { trace: true })].map((s) => s.stage);

    expect(stages[0]).toBe('population');
    expect(stages[1]).toBe('evaluate');
    expect(stages[stages.length - 1]).toBe('replace');

    // Between those, breeding repeats select -> crossover -> mutate per pair. Grouping the
    // phases instead would have changed the order of random draws; see `breed`.
    const middle = stages.slice(2, -1);
    expect(middle.length % 3).toBe(0);
    for (let i = 0; i < middle.length; i += 3) {
      expect([middle[i], middle[i + 1], middle[i + 2]]).toEqual(['select', 'crossover', 'mutate']);
    }
    // 8 individuals minus 2 elites = 6 children = 3 pairs.
    expect(middle.length / 3).toBe(3);
  });

  it('reports selections that actually happened', () => {
    const island = createIsland(0, 4417, { size: 8, tournamentSize: 3 });
    const stages = [...generation(island, fakeEvaluate, { trace: true })];
    const select = stages.find((s) => s.stage === 'select');
    expect(select).toBeDefined();
    if (select?.stage !== 'select') throw new Error('unreachable');

    for (const t of select.tournaments) {
      expect(t.drawn).toHaveLength(3);
      expect(t.drawn).toContain(t.winner);
      for (const index of t.drawn) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(8);
      }
    }
  });

  it('reports crossover provenance per gene', () => {
    const island = createIsland(0, 4417, { size: 8 });
    const stages = [...generation(island, fakeEvaluate, { trace: true })];
    const cross = stages.find((s) => s.stage === 'crossover');
    if (cross?.stage !== 'crossover') throw new Error('expected a crossover stage');

    expect(cross.trace.blended).toHaveLength(cross.trace.a.length);
    // Where a gene was not blended, the children are exact copies of their parents.
    cross.trace.blended.forEach((wasBlended, i) => {
      if (!wasBlended) {
        expect(cross.trace.children[0]![i]).toBe(cross.trace.a[i]);
        expect(cross.trace.children[1]![i]).toBe(cross.trace.b[i]);
      }
    });
  });

  it('reports mutations that match the genes they changed', () => {
    const island = createIsland(0, 4417, { size: 12, mutationRate: 1 });
    const stages = [...generation(island, fakeEvaluate, { trace: true })];
    const mutations = stages.filter((s) => s.stage === 'mutate');
    expect(mutations.length).toBeGreaterThan(0);

    for (const stage of mutations) {
      if (stage.stage !== 'mutate') continue;
      stage.changes.forEach((changes, child) => {
        for (const c of changes) {
          expect(c.to).toBe(stage.children[child]![c.gene]);
          expect(c.to).toBeGreaterThanOrEqual(0);
          expect(c.to).toBeLessThanOrEqual(1);
        }
      });
    }
  });
});
