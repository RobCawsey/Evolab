import { describe, expect, it } from 'vitest';
import { Rng } from '@evolab/evolution';

/**
 * The RNG underpins ground rule 2 — every stochastic thing in the project draws from it.
 * If it silently changes, every stored gait, every reproducible run and the slice-2 golden
 * test all change with it, and nothing else would notice.
 */
describe('Rng', () => {
  it('produces a pinned sequence for a known seed', () => {
    // Golden vector. If this fails, the generator's algorithm changed. That is either a
    // bug or a deliberate act — say which, in the commit message, and regenerate.
    const r = new Rng(4417);
    expect([r.u32(), r.u32(), r.u32(), r.u32(), r.u32(), r.u32()]).toEqual([
      55303081, 2544064971, 1253366596, 4207743915, 143669195, 1700000921,
    ]);
  });

  it('replays identically from the same seed', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 500; i++) expect(a.u32()).toBe(b.u32());
  });

  it('diverges for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const same = Array.from({ length: 100 }, () => a.u32() === b.u32()).filter(Boolean);
    expect(same).toHaveLength(0);
  });

  it('exposes the seed it was constructed with', () => {
    expect(new Rng(4417).seed).toBe(4417);
  });

  describe('float', () => {
    it('stays within [0, 1)', () => {
      const r = new Rng(3);
      for (let i = 0; i < 20_000; i++) {
        const v = r.float();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('spreads roughly evenly across the unit interval', () => {
      const r = new Rng(5);
      const buckets = new Array(10).fill(0) as number[];
      const N = 100_000;
      for (let i = 0; i < N; i++) buckets[Math.floor(r.float() * 10)]! += 1;
      // Each decile should hold ~10%. Anything outside 9–11% means the generator is
      // skewed, which would bias every mutation in slice 2.
      for (const count of buckets) {
        expect(count / N).toBeGreaterThan(0.09);
        expect(count / N).toBeLessThan(0.11);
      }
    });
  });

  describe('range', () => {
    it('stays within bounds, including negative ranges', () => {
      const r = new Rng(11);
      for (let i = 0; i < 10_000; i++) {
        const v = r.range(-2, 5);
        expect(v).toBeGreaterThanOrEqual(-2);
        expect(v).toBeLessThan(5);
      }
    });

    it('returns the bound when the range is empty', () => {
      expect(new Rng(1).range(3, 3)).toBe(3);
    });
  });

  describe('int', () => {
    it('returns integers in [0, n)', () => {
      const r = new Rng(13);
      const seen = new Set<number>();
      for (let i = 0; i < 5_000; i++) {
        const v = r.int(7);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(7);
        seen.add(v);
      }
      // Tournament selection depends on every index being reachable.
      expect(seen.size).toBe(7);
    });
  });

  describe('normal', () => {
    it('is approximately standard normal', () => {
      const r = new Rng(7);
      const N = 200_000;
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < N; i++) {
        const v = r.normal();
        sum += v;
        sumSq += v * v;
      }
      const mean = sum / N;
      const variance = sumSq / N - mean * mean;
      expect(Math.abs(mean)).toBeLessThan(0.02);
      expect(variance).toBeGreaterThan(0.97);
      expect(variance).toBeLessThan(1.03);
    });

    it('never returns a non-finite value', () => {
      // Box–Muller divides by log(u); u must never be 0. The loop in normal() guards it,
      // and this asserts the guard actually holds across a long run.
      const r = new Rng(17);
      for (let i = 0; i < 100_000; i++) expect(Number.isFinite(r.normal())).toBe(true);
    });
  });

  it('does not collapse to a fixed point', () => {
    // xoshiro's all-zero state is absorbing. Seed 0 is the obvious way to hit it.
    const r = new Rng(0);
    const values = new Set(Array.from({ length: 1000 }, () => r.u32()));
    expect(values.size).toBeGreaterThan(990);
  });
});
