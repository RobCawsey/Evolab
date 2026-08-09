import { describe, expect, it } from 'vitest';
import {
  GAIT_RANGES,
  GENOME_LENGTH,
  Rng,
  decodeGenome,
  defaultGait,
  diversity,
  encodeGenome,
  mutate,
  randomGenome,
  sbx,
  score,
  tournament,
  type Genome,
  type TrialResult,
} from '@evolab/evolution';

const rng = () => new Rng(1234);

describe('randomGenome', () => {
  it('produces the requested length, all within [0, 1]', () => {
    const g = randomGenome(GENOME_LENGTH, rng());
    expect(g).toHaveLength(GENOME_LENGTH);
    for (const v of g) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('tournament', () => {
  it('never returns an out-of-range index', () => {
    const r = rng();
    const fitness = [0.1, 0.9, 0.4, 0.2, 0.7];
    for (let i = 0; i < 2000; i++) {
      const idx = tournament(fitness, 3, r);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(fitness.length);
    }
  });

  it('always returns the single best when the tournament covers everyone', () => {
    const fitness = [0.1, 0.9, 0.4];
    const r = rng();
    for (let i = 0; i < 200; i++) expect(tournament(fitness, 60, r)).toBe(1);
  });

  it('favours fitter individuals without excluding the weak', () => {
    // Selection pressure is meant to be gentle: with size 3 the worst of 24 should still
    // surface occasionally. A tournament that never picks a weak individual has collapsed
    // to elitism and will converge prematurely.
    const fitness = Array.from({ length: 24 }, (_, i) => i / 23);
    const r = rng();
    const counts = new Array(24).fill(0) as number[];
    for (let i = 0; i < 30_000; i++) counts[tournament(fitness, 3, r)]! += 1;
    expect(counts[23]!).toBeGreaterThan(counts[12]!);
    expect(counts[12]!).toBeGreaterThan(counts[0]!);
    expect(counts[0]!).toBeGreaterThan(0);
  });

  it('applies more pressure as the tournament grows', () => {
    const fitness = Array.from({ length: 24 }, (_, i) => i / 23);
    const share = (size: number) => {
      const r = new Rng(5);
      let top = 0;
      for (let i = 0; i < 20_000; i++) if (tournament(fitness, size, r) >= 20) top++;
      return top / 20_000;
    };
    expect(share(5)).toBeGreaterThan(share(2));
  });
});

describe('sbx', () => {
  it('keeps children inside [0, 1]', () => {
    const r = rng();
    for (let i = 0; i < 500; i++) {
      const [c1, c2] = sbx(randomGenome(11, r), randomGenome(11, r), r);
      for (const v of [...c1, ...c2]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('returns clones when the parents are identical', () => {
    // SBX interpolates, so identical parents can only produce identical children. If this
    // fails the operator is injecting variation it should not.
    const r = rng();
    const parent = randomGenome(11, r);
    const [c1, c2] = sbx(parent, Float32Array.from(parent), r);
    expect(Array.from(c1)).toEqual(Array.from(parent));
    expect(Array.from(c2)).toEqual(Array.from(parent));
  });

  it('preserves the sum of each gene pair', () => {
    // c1 + c2 == p1 + p2 for every gene, by construction. A cheap, exact invariant that
    // catches an algebra slip in the beta formula.
    const r = rng();
    for (let t = 0; t < 200; t++) {
      const p1 = randomGenome(11, r);
      const p2 = randomGenome(11, r);
      const [c1, c2] = sbx(p1, p2, r, 15, 1);
      for (let i = 0; i < p1.length; i++) {
        // Only where no clamping occurred, since clamping legitimately breaks the sum.
        const sum = c1[i]! + c2[i]!;
        const inside = c1[i]! > 0 && c1[i]! < 1 && c2[i]! > 0 && c2[i]! < 1;
        if (inside) expect(sum).toBeCloseTo(p1[i]! + p2[i]!, 5);
      }
    }
  });

  it('copies parents through untouched when probability is zero', () => {
    const r = rng();
    const p1 = randomGenome(11, r);
    const p2 = randomGenome(11, r);
    const [c1, c2] = sbx(p1, p2, r, 15, 0);
    expect(Array.from(c1)).toEqual(Array.from(p1));
    expect(Array.from(c2)).toEqual(Array.from(p2));
  });

  it('does not mutate its parents', () => {
    const r = rng();
    const p1 = randomGenome(11, r);
    const before = Array.from(p1);
    sbx(p1, randomGenome(11, r), r);
    expect(Array.from(p1)).toEqual(before);
  });

  it('keeps children nearer the parents at higher eta', () => {
    const spread = (eta: number) => {
      const r = new Rng(3);
      const p1 = new Float32Array(11).fill(0.3);
      const p2 = new Float32Array(11).fill(0.7);
      let total = 0;
      for (let t = 0; t < 400; t++) {
        const [c1] = sbx(p1, p2, r, eta, 1);
        for (const v of c1) total += Math.abs(v - 0.5);
      }
      return total;
    };
    expect(spread(50)).toBeLessThan(spread(2));
  });
});

describe('mutate', () => {
  it('keeps genes inside [0, 1]', () => {
    const r = rng();
    for (let t = 0; t < 300; t++) {
      const g = mutate(randomGenome(11, r), r, 1);
      for (const v of g) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('changes nothing at rate zero', () => {
    const r = rng();
    const g = randomGenome(11, r);
    const before = Array.from(g);
    mutate(g, r, 0);
    expect(Array.from(g)).toEqual(before);
  });

  it('changes about one gene per genome at the default rate', () => {
    const r = rng();
    let changed = 0;
    const trials = 4000;
    for (let t = 0; t < trials; t++) {
      const g = randomGenome(11, r);
      const before = Array.from(g);
      mutate(g, r);
      for (let i = 0; i < g.length; i++) if (g[i] !== before[i]) changed++;
    }
    expect(changed / trials).toBeGreaterThan(0.7);
    expect(changed / trials).toBeLessThan(1.3);
  });

  it('makes small changes far more often than large ones', () => {
    // The polynomial distribution is sharply peaked at zero. That shape is what gives
    // fine adjustment by default and a rare chance of escaping a local optimum.
    const r = rng();
    let small = 0;
    let large = 0;
    for (let t = 0; t < 5000; t++) {
      const g = new Float32Array(1).fill(0.5);
      mutate(g, r, 1);
      const d = Math.abs(g[0]! - 0.5);
      if (d < 0.05) small++;
      if (d > 0.3) large++;
    }
    expect(small).toBeGreaterThan(large * 3);
    expect(large).toBeGreaterThan(0);
  });

  it('mutates in place and returns the same array', () => {
    const r = rng();
    const g = randomGenome(11, r);
    expect(mutate(g, r, 1)).toBe(g);
  });
});

describe('diversity', () => {
  it('is zero for a population of identical genomes', () => {
    const g = randomGenome(11, rng());
    expect(diversity([g, Float32Array.from(g), Float32Array.from(g)])).toBe(0);
  });

  it('is zero for fewer than two genomes', () => {
    expect(diversity([])).toBe(0);
    expect(diversity([randomGenome(11, rng())])).toBe(0);
  });

  it('grows as the population spreads out', () => {
    const tight = [new Float32Array(11).fill(0.5), new Float32Array(11).fill(0.51)];
    const wide = [new Float32Array(11).fill(0), new Float32Array(11).fill(1)];
    expect(diversity(wide)).toBeGreaterThan(diversity(tight));
  });

  it('matches a hand-computed distance', () => {
    const a = Float32Array.from([0, 0]);
    const b = Float32Array.from([3, 4]);
    expect(diversity([a, b])).toBeCloseTo(5, 6);
  });
});

describe('genome codec', () => {
  it('round-trips a gait through encode and decode', () => {
    const before = defaultGait();
    const after = decodeGenome(encodeGenome(before));
    expect(after.frequency).toBeCloseTo(before.frequency, 5);
    expect(after.balanceGain).toBeCloseTo(before.balanceGain, 5);
    for (const kind of ['hip', 'knee', 'ankle'] as const) {
      for (const key of ['amplitude', 'phase', 'centre'] as const) {
        expect(after[kind][key], `${kind}.${key}`).toBeCloseTo(before[kind][key], 5);
      }
    }
  });

  it('decodes the extremes to the ends of GAIT_RANGES', () => {
    const low = decodeGenome(new Float32Array(GENOME_LENGTH).fill(0));
    const high = decodeGenome(new Float32Array(GENOME_LENGTH).fill(1));
    expect(low.frequency).toBeCloseTo(GAIT_RANGES.frequency[0], 6);
    expect(high.frequency).toBeCloseTo(GAIT_RANGES.frequency[1], 6);
    expect(low.balanceGain).toBeCloseTo(GAIT_RANGES.balanceGain[0], 6);
    expect(high.ankle.centre).toBeCloseTo(GAIT_RANGES.ankle.centre[1], 6);
  });

  it('always decodes into a gait the controller will accept', () => {
    // Every genome the GA can produce must decode to parameters inside GAIT_RANGES,
    // otherwise the search can wander somewhere the sliders cannot express.
    const r = rng();
    const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo - 1e-6 && v <= hi + 1e-6;
    for (let t = 0; t < 500; t++) {
      const p = decodeGenome(randomGenome(GENOME_LENGTH, r));
      expect(within(p.frequency, GAIT_RANGES.frequency)).toBe(true);
      expect(within(p.balanceGain, GAIT_RANGES.balanceGain)).toBe(true);
      for (const kind of ['hip', 'knee', 'ankle'] as const) {
        for (const key of ['amplitude', 'phase', 'centre'] as const) {
          expect(within(p[kind][key], GAIT_RANGES[kind][key]), `${kind}.${key}`).toBe(true);
        }
      }
    }
  });

  it('agrees with the genome length the island uses', () => {
    expect(encodeGenome(defaultGait())).toHaveLength(GENOME_LENGTH);
  });
});

describe('score', () => {
  const base: TrialResult = {
    distance: 2, uprightTime: 4, effort: 50, fell: false, duration: 4,
  };

  it('sums its terms', () => {
    const s = score(base, 4);
    expect(s.total).toBeCloseTo(s.distance + s.upright + s.effort, 12);
  });

  it('rewards distance and staying upright', () => {
    expect(score({ ...base, distance: 3 }, 4).total).toBeGreaterThan(score(base, 4).total);
    expect(score({ ...base, uprightTime: 2 }, 4).total).toBeLessThan(score(base, 4).total);
  });

  it('measures upright against the requested duration, not the truncated one', () => {
    // A genome that falls at 1 s of a 4 s trial must not score as though it survived a
    // 1 s trial — that would make falling over early a winning move.
    const early: TrialResult = { distance: 2, uprightTime: 1, effort: 50, fell: true, duration: 1 };
    expect(score(early, 4).upright).toBeCloseTo(0.5 * 0.25, 10);
  });

  it('ignores effort below the budget and penalises above it', () => {
    expect(score({ ...base, effort: 100 }, 4).effort).toBe(0);
    expect(score({ ...base, effort: 400 }, 4).effort).toBeLessThan(0);
  });

  it('never returns a negative total', () => {
    const awful: TrialResult = {
      distance: -50, uprightTime: 0, effort: 9999, fell: true, duration: 0.1,
    };
    expect(score(awful, 4).total).toBe(0);
  });
});
