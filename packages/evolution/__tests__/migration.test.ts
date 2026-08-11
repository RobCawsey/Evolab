import { describe, expect, it } from 'vitest';
import {
  createIsland,
  evaluatePending,
  emigrants,
  immigrate,
  stepGeneration,
  type Genome,
  type TrialResult,
} from '@evolab/evolution';

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

describe('emigrants', () => {
  it('returns the fittest genomes', () => {
    const island = createIsland(0, 4417);
    stepGeneration(island, fakeEvaluate);
    stepGeneration(island, fakeEvaluate);

    const sorted = [...island.population].sort((a, b) => b.fitness - a.fitness);
    const out = emigrants(island, 2);
    expect(out).toHaveLength(2);
    expect(Array.from(out[0]!)).toEqual(Array.from(sorted[0]!.genes));
    expect(Array.from(out[1]!)).toEqual(Array.from(sorted[1]!.genes));
  });

  it('returns copies, not the island\'s own arrays', () => {
    // This is the one that matters. Migrants are transferred across a worker boundary and
    // a transferred ArrayBuffer is detached on the sending side — handing out the island's
    // own genomes would empty its population mid-run, which would look like the search
    // spontaneously collapsing.
    const island = createIsland(0, 1);
    const out = emigrants(island, 2);
    for (const g of out) {
      for (const ind of island.population) expect(g).not.toBe(ind.genes);
    }
    // Simulate the detach that postMessage would cause.
    const before = Array.from(island.population[0]!.genes);
    out[0]!.fill(0);
    expect(island.population.some((i) => Array.from(i.genes).every((v, k) => v === before[k])))
      .toBe(true);
  });

  it('never returns more than the population holds', () => {
    const island = createIsland(0, 1, { size: 3 });
    expect(emigrants(island, 10)).toHaveLength(3);
  });

  it('returns nothing when asked for nothing', () => {
    expect(emigrants(createIsland(0, 1), 0)).toHaveLength(0);
  });
});

describe('immigrate', () => {
  it('replaces the least fit individuals', () => {
    const island = createIsland(0, 4417);
    // Score the population first. Straight after `stepGeneration` the population is the
    // freshly bred one and almost everything sits at fitness 0, which would make "least
    // fit" an arbitrary choice and the assertion meaningless.
    evaluatePending(island, fakeEvaluate);

    const ranked = [...island.population].sort((a, b) => a.fitness - b.fitness);
    const doomed = [Array.from(ranked[0]!.genes), Array.from(ranked[1]!.genes)];
    const survivor = Array.from(ranked[ranked.length - 1]!.genes);
    const incoming = [new Float32Array(11).fill(0.25), new Float32Array(11).fill(0.75)];

    expect(immigrate(island, incoming)).toBe(2);

    const genomes = island.population.map((i) => Array.from(i.genes));
    expect(genomes).toContainEqual(Array.from(incoming[0]!));
    expect(genomes).toContainEqual(Array.from(incoming[1]!));
    expect(genomes).not.toContainEqual(doomed[0]);
    expect(genomes).not.toContainEqual(doomed[1]);
    expect(genomes).toContainEqual(survivor);
  });

  it('marks arrivals pending so they face this island\'s evaluator', () => {
    const island = createIsland(0, 1);
    stepGeneration(island, fakeEvaluate);
    immigrate(island, [new Float32Array(11).fill(0.5)]);
    const migrant = island.population.find((i) => i.genes.every((v) => v === 0.5));
    expect(migrant).toBeDefined();
    expect(migrant!.result).toBeNull();
    expect(migrant!.fitness).toBe(0);
  });

  it('copies the incoming genomes', () => {
    const island = createIsland(0, 1);
    // 0.25 rather than 0.3: a Float32Array rounds 0.3 to 0.30000001192092896, so comparing
    // it against the double literal fails. Powers of two survive the narrowing exactly.
    const incoming = new Float32Array(11).fill(0.25);
    immigrate(island, [incoming]);
    incoming.fill(0.5);
    expect(island.population.some((i) => i.genes.every((v) => v === 0.25))).toBe(true);
  });

  it('never displaces more than half the population', () => {
    // A flood of migrants would otherwise wipe out exactly the local variation the island
    // model exists to preserve.
    const island = createIsland(0, 1, { size: 24 });
    const flood = Array.from({ length: 24 }, () => new Float32Array(11).fill(0.7));
    expect(immigrate(island, flood)).toBe(12);
  });

  it('is a no-op for an empty delivery', () => {
    const island = createIsland(0, 1);
    const before = island.population.map((i) => Array.from(i.genes));
    expect(immigrate(island, [])).toBe(0);
    expect(island.population.map((i) => Array.from(i.genes))).toEqual(before);
  });

  it('lets a good migrant lift the receiving island', () => {
    // The observable effect migration exists for, asserted rather than assumed.
    //
    // Both islands are run to convergence, then the weaker one is deliberately crippled so
    // there is headroom to recover: without that, elitism means the receiving island's best
    // already exceeds anything a migrant can offer and the test would assert nothing.
    const strong = createIsland(1, 4417);
    for (let g = 0; g < 40; g++) stepGeneration(strong, fakeEvaluate);
    evaluatePending(strong, fakeEvaluate);

    const weak = createIsland(0, 91, { size: 24, elites: 0 });
    for (let g = 0; g < 3; g++) stepGeneration(weak, fakeEvaluate);
    evaluatePending(weak, fakeEvaluate);

    const before = Math.max(...weak.population.map((i) => i.fitness));
    const bestElsewhere = Math.max(...strong.population.map((i) => i.fitness));
    expect(bestElsewhere).toBeGreaterThan(before);

    immigrate(weak, emigrants(strong, 2));
    const after = stepGeneration(weak, fakeEvaluate).best;
    expect(after).toBeGreaterThan(before);
  });
});
