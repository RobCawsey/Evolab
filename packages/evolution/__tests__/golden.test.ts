import { describe, expect, it } from 'vitest';
import {
  createIsland,
  stepGeneration,
  type Genome,
  type TrialResult,
} from '@evolab/evolution';

/**
 * A deterministic synthetic evaluator: a closed-form function of the genome with no
 * physics in it at all.
 *
 * Using the real simulator here would couple the golden test to Rapier's version, to the
 * morphology, and to the motor gains — so a deliberate physics change would break a test
 * meant to guard the *algorithm*, and the two failures would be indistinguishable. This
 * keeps the test at millisecond speed and makes any failure mean exactly one thing: an
 * operator, the RNG, or the generation loop changed.
 *
 * The landscape is multi-modal on purpose. A linear one would be climbed by mutation alone
 * and would not notice if crossover or selection broke.
 */
function fakeEvaluate(genome: Genome, seed: number): TrialResult {
  let peaks = 0;
  for (let i = 0; i < genome.length; i++) {
    peaks += Math.sin((i + 1) * genome[i]! * Math.PI) * (1 - i / (genome.length * 2));
  }
  const distance = (peaks / genome.length) * 4;
  const uprightTime = 4 * (0.5 + 0.5 * Math.cos(genome[0]! * Math.PI));
  return {
    distance,
    uprightTime,
    effort: 60 + 40 * genome[1]! + seed * 0.01,
    fell: uprightTime < 3.9,
    duration: uprightTime,
  };
}

/**
 * Best fitness per generation for seed 4417, twenty generations, default configuration.
 *
 * If this fails, either a change is a bug or a change is deliberate. Say which, in the
 * commit message, and regenerate these numbers in the same commit. Do not loosen the
 * comparison to make it pass — an approximate golden test guards nothing.
 */
const GOLDEN = [
  1.5963710855614386, 1.6151632043676616, 2.0659725386693206,
  2.0659725386693206, 2.0733583139131615, 2.2763172046632203,
  2.2763172046632203, 2.505707566002008, 2.505707566002008,
  2.623557211470123, 2.681432795793044, 2.7076419875399633,
  2.7076419875399633, 2.8452414008703393, 2.8452414008703393,
  2.9268128416290375, 2.9268128416290375, 3.0057164688424405,
  3.0057164688424405, 3.0597124846734207,
];

describe('golden run', () => {
  it('evolves a known fitness sequence from seed 4417', () => {
    const island = createIsland(0, 4417);
    const sequence: number[] = [];
    for (let g = 0; g < 20; g++) sequence.push(stepGeneration(island, fakeEvaluate).best);
    expect(sequence).toEqual(GOLDEN);
  });

  it('replays identically from the same seed', () => {
    const a = createIsland(0, 99);
    const b = createIsland(0, 99);
    for (let g = 0; g < 15; g++) {
      const sa = stepGeneration(a, fakeEvaluate);
      const sb = stepGeneration(b, fakeEvaluate);
      expect(sb.best).toBe(sa.best);
      expect(sb.mean).toBe(sa.mean);
      expect(sb.diversity).toBe(sa.diversity);
      expect(Array.from(sb.bestGenome)).toEqual(Array.from(sa.bestGenome));
    }
  });

  it('diverges for different seeds', () => {
    const a = createIsland(0, 1);
    const b = createIsland(0, 2);
    for (let g = 0; g < 10; g++) {
      stepGeneration(a, fakeEvaluate);
      stepGeneration(b, fakeEvaluate);
    }
    expect(a.population[0]!.genes).not.toEqual(b.population[0]!.genes);
  });

  it('never loses ground, because of elitism', () => {
    // The property elitism exists to guarantee. Without it the best fitness wanders down
    // as well as up, and the resulting dips look exactly like a bug in the operators.
    const island = createIsland(0, 7);
    let previous = -Infinity;
    for (let g = 0; g < 60; g++) {
      const best = stepGeneration(island, fakeEvaluate).best;
      expect(best).toBeGreaterThanOrEqual(previous);
      previous = best;
    }
  });

  it('loses ground when elitism is switched off', () => {
    // The negative half: proves the test above is measuring elitism and not merely the
    // fact that a search usually improves.
    const island = createIsland(0, 7, { elites: 0 });
    let previous = -Infinity;
    let regressions = 0;
    for (let g = 0; g < 60; g++) {
      const best = stepGeneration(island, fakeEvaluate).best;
      if (best < previous - 1e-12) regressions++;
      previous = best;
    }
    expect(regressions).toBeGreaterThan(0);
  });

  it('improves substantially over a run', () => {
    const island = createIsland(0, 4417);
    const first = stepGeneration(island, fakeEvaluate).best;
    let last = first;
    for (let g = 1; g < 80; g++) last = stepGeneration(island, fakeEvaluate).best;
    expect(last).toBeGreaterThan(first * 1.05);
  });

  it('converges: diversity falls as the population agrees', () => {
    const island = createIsland(0, 4417);
    const first = stepGeneration(island, fakeEvaluate).diversity;
    let last = first;
    for (let g = 1; g < 40; g++) last = stepGeneration(island, fakeEvaluate).diversity;
    expect(first).toBeGreaterThan(0.5);
    expect(last).toBeLessThan(first * 0.5);
  });

  it('re-evaluates only the non-elite members of each generation', () => {
    const island = createIsland(0, 4417, { size: 24, elites: 2 });
    expect(stepGeneration(island, fakeEvaluate).evaluations).toBe(24);
    for (let g = 0; g < 5; g++) {
      expect(stepGeneration(island, fakeEvaluate).evaluations).toBe(22);
    }
  });
});
