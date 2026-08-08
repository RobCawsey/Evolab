import { describe, expect, it } from 'vitest';
import { simpleBiped, type Segment } from '@evolab/evolution';

const morph = simpleBiped();
const byId = new Map<string, Segment>(morph.segments.map((s) => [s.id, s]));

/** Rapier's 2D world computes mass as density x area, not density x volume. */
function massOf(s: Segment): number {
  return 2 * s.halfWidth * 2 * s.halfHeight * s.density;
}

describe('simpleBiped', () => {
  it('has the expected structure', () => {
    expect(morph.segments).toHaveLength(7);
    expect(morph.joints).toHaveLength(6);
    expect(new Set(morph.segments.map((s) => s.id)).size).toBe(7);
    expect(new Set(morph.joints.map((j) => j.id)).size).toBe(6);
  });

  it('weighs about 21 kg', () => {
    // Regression test for the slice-1 bug. Density is mass per unit AREA in 2D Rapier, so
    // `density: 1000` silently built a 163 kg biped. Nothing else in the system noticed,
    // because acceleration-based motors are mass-independent — but every torque figure
    // was meaningless. This assertion is the cheapest possible guard on that unit.
    const total = morph.segments.reduce((sum, s) => sum + massOf(s), 0);
    expect(total).toBeGreaterThan(18);
    expect(total).toBeLessThan(25);
  });

  it('has no segment heavier than the torso', () => {
    const torso = massOf(byId.get('torso')!);
    for (const s of morph.segments) {
      if (s.id !== 'torso') expect(massOf(s)).toBeLessThan(torso);
    }
  });

  describe('joints', () => {
    it('reference segments that exist', () => {
      for (const j of morph.joints) {
        expect(byId.has(j.parent), `${j.id} parent ${j.parent}`).toBe(true);
        expect(byId.has(j.child), `${j.id} child ${j.child}`).toBe(true);
      }
    });

    it('close the kinematic chain in the rest pose', () => {
      // Each anchor pair must describe the SAME world point when the bodies are at their
      // rest positions. If they do not, Rapier yanks the bodies together on the first
      // step and the robot starts with a jolt that nothing in the UI would explain.
      for (const j of morph.joints) {
        const parent = byId.get(j.parent)!;
        const child = byId.get(j.child)!;
        const px = parent.x + j.parentAnchor[0];
        const py = parent.y + j.parentAnchor[1];
        const cx = child.x + j.childAnchor[0];
        const cy = child.y + j.childAnchor[1];
        expect(px, `${j.id} anchor x`).toBeCloseTo(cx, 10);
        expect(py, `${j.id} anchor y`).toBeCloseTo(cy, 10);
      }
    });

    it('have non-degenerate limits that admit the rest pose', () => {
      for (const j of morph.joints) {
        const [min, max] = j.limits;
        expect(min, `${j.id}`).toBeLessThan(max);
        // Joint angles are measured relative to the rest pose, so 0 must be legal —
        // otherwise the robot is born in violation of its own constraints.
        expect(min, `${j.id} rest pose below min`).toBeLessThanOrEqual(0);
        expect(max, `${j.id} rest pose above max`).toBeGreaterThanOrEqual(0);
      }
    });

    it('come in mirrored left/right pairs of each kind', () => {
      for (const kind of ['hip', 'knee', 'ankle'] as const) {
        const pair = morph.joints.filter((j) => j.kind === kind);
        expect(pair, kind).toHaveLength(2);
        expect(new Set(pair.map((j) => j.side))).toEqual(new Set(['L', 'R']));
        // The controller keys parameters by kind, so a mismatched pair would silently
        // give the two legs different limits.
        expect(pair[0]!.limits).toEqual(pair[1]!.limits);
        expect(pair[0]!.maxTorque).toBe(pair[1]!.maxTorque);
      }
    });

    it('carry a positive torque budget', () => {
      for (const j of morph.joints) expect(j.maxTorque).toBeGreaterThan(0);
    });
  });

  describe('rest pose', () => {
    it('stands on the ground rather than through or above it', () => {
      const lowest = Math.min(...morph.segments.map((s) => s.y - s.halfHeight));
      expect(lowest).toBeCloseTo(0, 6);
    });

    it('is about as tall as it claims', () => {
      const top = Math.max(...morph.segments.map((s) => s.y + s.halfHeight));
      expect(top).toBeCloseTo(morph.standingHeight, 2);
    });

    it('puts the centre of mass over the feet', () => {
      // If this fails the biped cannot stand even when perfectly rigid, and every control
      // problem downstream becomes unfalsifiable.
      let mass = 0;
      let mx = 0;
      for (const s of morph.segments) {
        const m = massOf(s);
        mass += m;
        mx += m * s.x;
      }
      const comX = mx / mass;
      const foot = byId.get('footL')!;
      expect(comX).toBeGreaterThan(foot.x - foot.halfWidth);
      expect(comX).toBeLessThan(foot.x + foot.halfWidth);
    });
  });
});
