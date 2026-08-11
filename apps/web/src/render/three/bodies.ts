/**
 * Snapshot → boxes. The whole of the 2D-simulation-to-3D-scene mapping, in one pure module.
 *
 * **Imports nothing from Three.js on purpose.** Everything here is arithmetic on a
 * `Snapshot`, so it runs and is tested under Node without a canvas, a WebGL context or a
 * 600 kB dependency. `scene.ts` is the only file that turns these numbers into meshes, which
 * keeps the part worth testing separate from the part that can only be looked at.
 *
 * The simulation is strictly sagittal: x is forward, y is up, and every body rotates about
 * the lateral axis. So the third dimension is not simulated at all — it is a constant per
 * `layer`, and this module is where that constant is decided and where the fact is written
 * down. See §9: the robot cannot fall sideways, and the 3D view must not pretend otherwise.
 */

import type { Snapshot } from '@evolab/sim';

/** One axis-aligned box before rotation, in world metres. Full extents, not half. */
export interface BoxInstance {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Rotation about the lateral (z) axis, radians. The only rotation a sagittal sim has. */
  readonly angle: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
}

/**
 * How far each leg sits either side of the centreline.
 *
 * Half the torso's half-width, so a thigh the same width as half the torso sits with its
 * outer face flush against the torso's side and its inner face on the centreline. Legs end
 * up *under* the body rather than outside it — the first version used the full half-width
 * and gave the robot a permanent wide stance that read as a deformity rather than a pose.
 *
 * Derived from the torso rather than hardcoded so the body editor's torso-width slider moves
 * the legs with it. For the reference body it is ±0.045 m.
 *
 * This replaces `FAR_LEG_RENDER_OFFSET`, the 2D renderer's sideways nudge. That fudge exists
 * because a strictly sagittal biped's legs overlap exactly and look like a pogo stick; here
 * the legs are genuinely apart, so the nudge must **not** be applied as well — doing both
 * would separate them twice and by different amounts in the two views.
 */
export function lateralOffset(snap: Snapshot): number {
  const torso = snap.bodies.find((b) => b.layer === 'body');
  return (torso ? torso.halfWidth : 0.18) / 2;
}

/**
 * Depth of a segment: the thinner of its two visible dimensions.
 *
 * A one-line rule rather than a table. The torso and the limbs are taller than they are
 * wide, so they get a square cross-section; the foot is long and flat, so it stays a plank
 * instead of becoming a paving slab. Nothing in the simulation has a depth, so any rule here
 * is a drawing decision — this one is at least consistent.
 */
function depthOf(halfWidth: number, halfHeight: number): number {
  return 2 * Math.min(halfWidth, halfHeight);
}

/**
 * Lay a snapshot out as boxes.
 *
 * Pass `out` to reuse the array across frames — this runs every rendered frame and the
 * garbage from a fresh array of seven objects sixty times a second is avoidable.
 */
export function layoutBodies(snap: Snapshot, out: BoxInstance[] = []): BoxInstance[] {
  const offset = lateralOffset(snap);
  out.length = 0;
  for (const b of snap.bodies) {
    out.push({
      id: b.id,
      x: b.x,
      y: b.y,
      z: b.layer === 'near' ? offset : b.layer === 'far' ? -offset : 0,
      angle: b.angle,
      sx: b.halfWidth * 2,
      sy: b.halfHeight * 2,
      sz: depthOf(b.halfWidth, b.halfHeight),
    });
  }
  return out;
}

/**
 * Where the camera should look: the torso, or the origin if there is not one.
 *
 * Following the torso rather than the centre of mass, for the same reason the 2D camera
 * does — the centre of mass jitters with the swing leg and makes the whole scene wobble.
 */
export function focusPoint(snap: Snapshot): { x: number; y: number; z: number } {
  const torso = snap.bodies.find((b) => b.layer === 'body');
  return { x: torso?.x ?? 0, y: torso?.y ?? 0.7, z: 0 };
}
