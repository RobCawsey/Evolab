import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@evolab/sim';
import { focusPoint, lateralOffset, layoutBodies } from '../src/render/three/bodies.ts';

/**
 * The point of this file is that it exists at all. `bodies.ts` holds every decision about
 * how a 2D sagittal simulation becomes a 3D scene, and it imports nothing from Three.js —
 * so all of it can be checked here, in Node, without a WebGL context. If a future change
 * makes this file impossible to write, the render layer has stopped being separable.
 */

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    time: 0,
    steps: 0,
    bodies: [
      { id: 'torso', x: 1, y: 0.74, angle: 0.1, halfWidth: 0.09, halfHeight: 0.18, layer: 'body' },
      { id: 'thighL', x: 1, y: 0.5, angle: -0.2, halfWidth: 0.045, halfHeight: 0.13, layer: 'near' },
      { id: 'footL', x: 1.1, y: 0.025, angle: 0, halfWidth: 0.08, halfHeight: 0.025, layer: 'near' },
      { id: 'thighR', x: 1, y: 0.5, angle: 0.2, halfWidth: 0.045, halfHeight: 0.13, layer: 'far' },
    ],
    joints: [],
    torsoHeight: 0.74,
    fallen: false,
    distance: 1,
    jointAngles: new Map(),
    ...over,
  };
}

describe('laying a snapshot out as boxes', () => {
  it('puts the legs under the torso, not outside it', () => {
    const boxes = layoutBodies(snapshot());
    const by = (id: string) => boxes.find((b) => b.id === id)!;

    expect(by('torso').z).toBe(0);
    expect(by('thighL').z).toBeCloseTo(0.045, 10);
    expect(by('thighR').z).toBeCloseTo(-0.045, 10);
    // A thigh half the torso's width ends up flush with the torso's side face and its
    // inner face on the centreline — under the body rather than splayed out beside it.
    const torso = snapshot().bodies[0]!;
    expect(by('thighL').z + by('thighL').sz / 2).toBeCloseTo(torso.halfWidth, 10);

    // Near and far are mirrored, not merely different.
    expect(by('thighL').z).toBeCloseTo(-by('thighR').z, 10);
  });

  it('derives the leg separation from the torso, so the body editor stays coherent', () => {
    // A wider torso must move the legs with it. Hardcoding ±0.09 would leave them floating
    // inside a wide body or outside a narrow one, and the editor can change torso width.
    const wide = snapshot({
      bodies: [
        { id: 'torso', x: 0, y: 0.7, angle: 0, halfWidth: 0.15, halfHeight: 0.18, layer: 'body' },
        { id: 'thighL', x: 0, y: 0.5, angle: 0, halfWidth: 0.045, halfHeight: 0.13, layer: 'near' },
      ],
    });
    expect(lateralOffset(wide)).toBeCloseTo(0.075, 10);
    expect(layoutBodies(wide).find((b) => b.id === 'thighL')!.z).toBeCloseTo(0.075, 10);
  });

  it('passes position and rotation through untouched', () => {
    // The sagittal plane is the simulation's, not the renderer's. If x, y or angle were
    // adjusted here the 3D view would disagree with the 2D view about where the robot is.
    const boxes = layoutBodies(snapshot());
    const thigh = boxes.find((b) => b.id === 'thighL')!;
    expect(thigh.x).toBe(1);
    expect(thigh.y).toBe(0.5);
    expect(thigh.angle).toBe(-0.2);
  });

  it('keeps a long flat foot a plank rather than a paving slab', () => {
    // Depth is the thinner of the two visible dimensions. The foot is 0.16 long and 0.05
    // thick, so extruding it by its length would give a foot wider than the whole robot.
    const boxes = layoutBodies(snapshot());
    const foot = boxes.find((b) => b.id === 'footL')!;
    expect(foot.sx).toBeCloseTo(0.16, 10);
    expect(foot.sy).toBeCloseTo(0.05, 10);
    expect(foot.sz).toBeCloseTo(0.05, 10);
    expect(foot.sz).toBeLessThan(foot.sx);

    // The torso is taller than it is wide, so it gets a square cross-section.
    const torso = boxes.find((b) => b.id === 'torso')!;
    expect(torso.sz).toBeCloseTo(torso.sx, 10);
  });

  it('reuses the output array instead of growing it', () => {
    // Called every rendered frame. A fresh array of seven objects sixty times a second is
    // avoidable garbage, and `out.length = 0` is the whole fix.
    const out = layoutBodies(snapshot());
    const same = layoutBodies(snapshot(), out);
    expect(same).toBe(out);
    expect(same).toHaveLength(4);
    layoutBodies(snapshot(), out);
    expect(out).toHaveLength(4);
  });
});

describe('camera focus', () => {
  it('follows the torso, not the centre of mass', () => {
    // The centre of mass jitters with the swing leg and makes the whole scene wobble.
    expect(focusPoint(snapshot())).toEqual({ x: 1, y: 0.74, z: 0 });
  });

  it('falls back to a sane point when there is no torso', () => {
    expect(focusPoint(snapshot({ bodies: [] }))).toEqual({ x: 0, y: 0.7, z: 0 });
  });
});
