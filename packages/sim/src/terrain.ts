/**
 * The ground, as a height profile — slice 14.
 *
 * For thirteen slices the floor was a plane at y = 0 and three separate things quietly
 * depended on it: the fall test compared an *absolute* torso height, the foot-contact test
 * compared against zero, and stride and duty were derived from that contact. The task suite
 * needs ramps, steps and rough ground, so all three become relative to the ground beneath the
 * robot — and this module is where that ground is defined.
 *
 * **Pure, and it imports nothing from Rapier.** A `TerrainSpec` becomes a `Float32Array` of
 * heights by arithmetic alone, so every profile can be checked in Node without a physics world,
 * the same way `render/three/bodies.ts` is checked without a WebGL context. If that stops being
 * true, terrain has stopped being separable from the simulator.
 *
 * **One array, two consumers.** The heights that build the collider and the heights that answer
 * `groundHeightAt` are the same buffer. If they ever disagree the robot floats or sinks and
 * nothing on screen explains why — the same rule as slice 10's one time axis, one frame index.
 */

/**
 * Distance between height samples, metres.
 *
 * Two centimetres, which decides what a "step" is at this fidelity: a 12 cm riser occupies one
 * sample, so its face is an 80° slope rather than a true vertical. That is a real limitation
 * and it lives here rather than in a commit message. A heightfield cannot represent an
 * overhang or a vertical wall at all; the day a task needs one is the day steps stop being
 * heightfield terrain and become box colliders.
 */
export const SAMPLE_SPACING = 0.02;

/** How far the ground extends behind the spawn point, metres. */
const BEHIND = 4;

export type TerrainSpec =
  /** The floor every slice before this one had. */
  | { readonly kind: 'flat'; readonly length: number }
  /** A constant slope. Positive climbs. */
  | { readonly kind: 'ramp'; readonly length: number; readonly degrees: number }
  /**
   * Seeded value noise — §6's "Perlin heightfield, ±4 cm".
   *
   * Value noise with cosine interpolation rather than true Perlin: one fewer table, no
   * gradients, and at this amplitude the difference is invisible. What matters is that it is
   * seeded and reproducible, like everything else in this project.
   */
  | {
      readonly kind: 'rough';
      readonly length: number;
      readonly amplitude: number;
      /** Distance between noise control points, metres. Sets the bump wavelength. */
      readonly wavelength: number;
      readonly seed: number;
    }
  /** Risers of equal height, flat between them. */
  | {
      readonly kind: 'steps';
      readonly length: number;
      readonly count: number;
      readonly rise: number;
      /** Distance from the spawn point to the first riser, metres. */
      readonly start: number;
      /** Flat distance between risers, metres. */
      readonly tread: number;
    };

export interface Terrain {
  readonly spec: TerrainSpec;
  /** Height at each sample, from `x0` in steps of `SAMPLE_SPACING`. */
  readonly heights: Float32Array;
  /** World x of `heights[0]`. Negative: the ground starts behind the spawn point. */
  readonly x0: number;
}

/** The flat floor, as a `TerrainSpec`. Every earlier slice is this case. */
export const FLAT: TerrainSpec = { kind: 'flat', length: 60 };

/**
 * A deterministic hash of one integer, for value noise.
 *
 * Not `Rng`: this needs a *positional* value — the same control point must produce the same
 * height however the terrain is sampled — and a sequential generator cannot do that. It is
 * still seeded and still reproducible, which is what invariant 2 is protecting.
 */
function hash(i: number, seed: number): number {
  let h = Math.imul(i ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  // >>> 0 first: the result is a signed 32-bit int and the sign bit is as good as any other.
  return (h >>> 0) / 0x100000000;
}

/** Cosine interpolation. Smooth enough that a foot does not catch on a sample boundary. */
function smooth(a: number, b: number, t: number): number {
  const u = (1 - Math.cos(t * Math.PI)) / 2;
  return a + (b - a) * u;
}

export function buildTerrain(spec: TerrainSpec): Terrain {
  const x0 = -BEHIND;
  const count = Math.ceil((spec.length + BEHIND) / SAMPLE_SPACING) + 1;
  const heights = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    heights[i] = heightOf(spec, x0 + i * SAMPLE_SPACING);
  }

  return { spec, heights, x0 };
}

/**
 * The profile itself, as arithmetic on one x.
 *
 * Every terrain is flat behind the spawn point, so the robot always starts on level ground
 * whatever it is about to walk onto. A ramp that began at x = −4 would have it spawn four
 * metres up a slope, and a task's difficulty would depend on how far back the ground happened
 * to extend.
 */
function heightOf(spec: TerrainSpec, x: number): number {
  if (x <= 0) return 0;

  switch (spec.kind) {
    case 'flat':
      return 0;

    case 'ramp':
      return x * Math.tan((spec.degrees * Math.PI) / 180);

    case 'rough': {
      const t = x / spec.wavelength;
      const i = Math.floor(t);
      const a = hash(i, spec.seed) * 2 - 1;
      const b = hash(i + 1, spec.seed) * 2 - 1;
      const h = smooth(a, b, t - i) * spec.amplitude;
      // Eased in over the first wavelength, so the robot is not asked to deal with a bump
      // before it has taken a stride. Without this the first sample can be a 4 cm step.
      return x < spec.wavelength ? h * (x / spec.wavelength) : h;
    }

    case 'steps': {
      if (x < spec.start) return 0;
      // Step n covers [start + (n-1)·tread, start + n·tread) and its top is n·rise — the same
      // arithmetic the collider uses, because the two must not disagree by so much as a sample.
      const n = Math.floor((x - spec.start) / spec.tread) + 1;
      return Math.min(n, spec.count) * spec.rise;
    }
  }
}

/**
 * Ground height under a world x, by linear interpolation between samples.
 *
 * This is the function the fall test and the contact test ask, and it reads the same array the
 * collider was built from. Off either end it clamps rather than extrapolating: a robot past the
 * end of the terrain has already finished, and extrapolating a ramp forever would let it climb
 * out of the world.
 */
export function groundHeightAt(terrain: Terrain, x: number): number {
  const { heights, x0 } = terrain;
  const t = (x - x0) / SAMPLE_SPACING;
  if (t <= 0) return heights[0] ?? 0;
  const last = heights.length - 1;
  if (t >= last) return heights[last] ?? 0;
  const i = Math.floor(t);
  const a = heights[i] ?? 0;
  const b = heights[i + 1] ?? 0;
  return a + (b - a) * (t - i);
}

/** Steepest slope anywhere in the profile, radians. Used to sanity-check a task. */
export function maxSlope(terrain: Terrain): number {
  let steepest = 0;
  for (let i = 1; i < terrain.heights.length; i++) {
    const d = Math.abs((terrain.heights[i] ?? 0) - (terrain.heights[i - 1] ?? 0));
    if (d > steepest) steepest = d;
  }
  return Math.atan2(steepest, SAMPLE_SPACING);
}
