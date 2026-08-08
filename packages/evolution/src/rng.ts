/**
 * xoshiro128** — seeded, fast, and good enough for evolutionary search.
 *
 * Invariant 2: this is the only source of randomness in the project. There is no
 * `Math.random()` anywhere in `packages/`, because a run that cannot be replayed cannot
 * be debugged and cannot be golden-tested.
 */

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** splitmix32 — used only to expand a single seed into four state words. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export class Rng {
  readonly seed: number;
  private readonly s: Uint32Array;

  // Note: a TypeScript parameter property (`constructor(readonly seed: number)`) would be
  // neater, but it emits code rather than erasing types, so Node's `--experimental-strip-types`
  // rejects it. Keeping every source file strip-compatible is what lets `npm run sim` and the
  // slice-2 golden test run without a build step.
  constructor(seed: number) {
    this.seed = seed;
    const mix = splitmix32(seed);
    this.s = new Uint32Array([mix(), mix(), mix(), mix()]);
    // A four-zero state is a fixed point of the generator. Unreachable from splitmix32
    // in practice, but cheap to rule out.
    if (this.s.every((w) => w === 0)) this.s[0] = 1;
  }

  /** Raw 32-bit unsigned integer. */
  u32(): number {
    const s = this.s;
    const s0 = s[0] as number;
    const s1 = s[1] as number;
    const s2 = s[2] as number;
    const s3 = s[3] as number;

    const result = (Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0) as number;
    const t = (s1 << 9) >>> 0;

    s[2] = (s2 ^ s0) >>> 0;
    s[3] = (s3 ^ s1) >>> 0;
    s[1] = (s1 ^ (s[2] as number)) >>> 0;
    s[0] = (s0 ^ (s[3] as number)) >>> 0;
    s[2] = ((s[2] as number) ^ t) >>> 0;
    s[3] = rotl(s[3] as number, 11) >>> 0;

    return result;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.float() * (hi - lo);
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** Standard normal, via Box–Muller. Used by mutation from slice 2. */
  normal(): number {
    let u = 0;
    while (u === 0) u = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.float());
  }
}
