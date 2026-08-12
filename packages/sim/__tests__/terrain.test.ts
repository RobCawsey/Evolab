import { describe, expect, it } from 'vitest';
import {
  buildTerrain,
  FLAT,
  groundHeightAt,
  maxSlope,
  SAMPLE_SPACING,
  type TerrainSpec,
} from '../src/terrain.ts';

describe('terrain profiles', () => {
  it('is flat behind the spawn point whatever it does in front', () => {
    // Every task spawns the robot on level ground, so its difficulty cannot depend on how far
    // back the ground happens to extend.
    for (const spec of [
      FLAT,
      { kind: 'ramp', length: 20, degrees: 12 },
      { kind: 'steps', length: 20, count: 4, rise: 0.12, start: 2, tread: 0.6 },
      { kind: 'rough', length: 20, amplitude: 0.04, wavelength: 0.5, seed: 1 },
    ] satisfies TerrainSpec[]) {
      const t = buildTerrain(spec);
      for (const x of [-4, -2, -0.5, 0]) {
        expect(groundHeightAt(t, x), `${spec.kind} at x=${x}`).toBe(0);
      }
    }
  });

  it('a ramp is its own tangent', () => {
    const t = buildTerrain({ kind: 'ramp', length: 20, degrees: 12 });
    const slope = Math.tan((12 * Math.PI) / 180);
    for (const x of [1, 5, 10]) {
      expect(groundHeightAt(t, x)).toBeCloseTo(x * slope, 6);
    }
  });

  it('a 0° ramp is indistinguishable from flat ground', () => {
    // Not a curiosity: the world builds a 0° ramp as a single rotated slab and flat ground as
    // the original slab, and the slice 14 measurements lean on the two agreeing.
    const flat = buildTerrain(FLAT);
    const level = buildTerrain({ kind: 'ramp', length: 20, degrees: 0 });
    for (let x = -4; x < 20; x += 0.37) {
      expect(groundHeightAt(level, x)).toBe(groundHeightAt(flat, x));
    }
  });

  it('steps rise once per tread and then stop', () => {
    const t = buildTerrain({ kind: 'steps', length: 20, count: 3, rise: 0.1, start: 2, tread: 1 });
    expect(groundHeightAt(t, 1.5)).toBe(0);
    expect(groundHeightAt(t, 2.5)).toBeCloseTo(0.1, 6);
    expect(groundHeightAt(t, 3.5)).toBeCloseTo(0.2, 6);
    expect(groundHeightAt(t, 4.5)).toBeCloseTo(0.3, 6);
    // Three risers means three, however far the course runs on.
    expect(groundHeightAt(t, 12)).toBeCloseTo(0.3, 6);
  });

  it('rough terrain is seeded, reproducible, and within its amplitude', () => {
    const a = buildTerrain({ kind: 'rough', length: 20, amplitude: 0.04, wavelength: 0.5, seed: 7 });
    const b = buildTerrain({ kind: 'rough', length: 20, amplitude: 0.04, wavelength: 0.5, seed: 7 });
    const c = buildTerrain({ kind: 'rough', length: 20, amplitude: 0.04, wavelength: 0.5, seed: 8 });

    expect([...a.heights]).toEqual([...b.heights]);
    expect([...a.heights]).not.toEqual([...c.heights]);
    for (const h of a.heights) expect(Math.abs(h)).toBeLessThanOrEqual(0.04 + 1e-9);
  });

  it('eases roughness in, so the first sample is not a step', () => {
    const t = buildTerrain({ kind: 'rough', length: 20, amplitude: 0.04, wavelength: 0.5, seed: 3 });
    // Within the first wavelength the profile is scaled towards zero at the spawn point.
    expect(Math.abs(groundHeightAt(t, 0.02))).toBeLessThan(0.004);
  });

  it('clamps past the ends rather than extrapolating', () => {
    // A ramp extrapolated forever would let a robot climb out of the world.
    const t = buildTerrain({ kind: 'ramp', length: 20, degrees: 30 });
    const end = groundHeightAt(t, 20);
    expect(groundHeightAt(t, 1000)).toBeCloseTo(end, 6);
    expect(groundHeightAt(t, -1000)).toBe(0);
  });

  it('samples at the stated spacing', () => {
    const t = buildTerrain({ kind: 'ramp', length: 10, degrees: 45 });
    const rise = t.heights[201]! - t.heights[200]!;
    expect(rise).toBeCloseTo(SAMPLE_SPACING, 6);
  });

  it('reports the steepest slope it contains', () => {
    // Two places, not four: the heights are a Float32Array, so a 20° ramp reads 20.0006°.
    expect((maxSlope(buildTerrain({ kind: 'ramp', length: 10, degrees: 20 })) * 180) / Math.PI)
      .toBeCloseTo(20, 2);
    expect(maxSlope(buildTerrain(FLAT))).toBe(0);
  });
});
