/**
 * A recorded trajectory: what the robot did, frame by frame, so it can be replayed and
 * scrubbed instead of only scored.
 *
 * Recording is **opt-in and off by default**. `evaluate` runs tens of thousands of times per
 * study and the inner loop must not allocate; a recorded trial is for the one genome someone
 * is actually looking at. Everything here is flat typed arrays with a stride rather than an
 * array of frame objects, because 240 frames of 7 bodies is 1,680 little objects that exist
 * only to be read once by a renderer.
 *
 * Sampled at 60 Hz — every fourth physics step. The simulation still steps at 1/240 s
 * (invariant 1); this is the rate the trajectory is *observed* at, and four times fewer
 * samples loses nothing a screen can show.
 *
 * The format is deliberately wider than the 3D replay needs. Slice 10's footfall diagram
 * reads `contact`, its joint-angle traces read `jointAngles`, and both share a scrubber with
 * the replay — so capturing them now costs a few kilobytes and saves re-running every trial
 * later. A 4-second trial is about 40 kB in total.
 */

import type { BodyPose, JointAnchor, Snapshot } from './world.ts';

export const RECORD_HZ = 60;

export interface Recording {
  /** Body ids, in the order their poses appear within a frame. */
  readonly bodies: readonly string[];
  /** Half-extents per body, `bodies.length × 2`. Constant for a trial, so stored once. */
  readonly extents: Float32Array;
  readonly layers: readonly ('near' | 'far' | 'body')[];
  /** Joint ids, in the order their anchors and angles appear within a frame. */
  readonly joints: readonly string[];
  readonly jointLayers: readonly ('near' | 'far' | 'body')[];

  readonly hz: number;
  /** Frames captured. Short of the requested length when the robot fell early. */
  readonly frames: number;

  /** `frames × bodies × 3` — x, y, angle. Row-major by frame. */
  readonly pose: Float32Array;
  /** `frames × joints × 2` — world position of each joint anchor. */
  readonly anchors: Float32Array;
  /** `frames × joints` — achieved joint angle relative to the rest pose, radians. */
  readonly jointAngles: Float32Array;
  /** `frames × 2` — 1 when that foot is on the ground. Left, then right. */
  readonly contact: Uint8Array;
  /** `frames` — torso displacement from spawn, metres. */
  readonly distance: Float32Array;
  /** `frames` — torso centre height, metres. */
  readonly torsoHeight: Float32Array;
  readonly fell: boolean;
}

/** Seconds at a given frame. Exact, because the sample rate divides the timestep evenly. */
export function timeAt(rec: Recording, frame: number): number {
  return frame / rec.hz;
}

/**
 * Rebuild a `Snapshot` from one recorded frame.
 *
 * This is what lets the scrubber drive the 2D renderer and the 3D renderer from the same
 * data — both take a `Snapshot`, so neither needs to know a recording exists. Without it the
 * two views would each interpolate the trajectory their own way and would drift apart at
 * exactly the moment someone is comparing them frame by frame.
 *
 * Allocates. It is called once per rendered frame at most, never inside a trial.
 */
export function snapshotAt(rec: Recording, frame: number): Snapshot {
  const f = Math.max(0, Math.min(rec.frames - 1, Math.round(frame)));
  const nb = rec.bodies.length;
  const nj = rec.joints.length;

  const bodies: BodyPose[] = [];
  for (let i = 0; i < nb; i++) {
    const o = (f * nb + i) * 3;
    bodies.push({
      id: rec.bodies[i]!,
      x: rec.pose[o]!,
      y: rec.pose[o + 1]!,
      angle: rec.pose[o + 2]!,
      halfWidth: rec.extents[i * 2]!,
      halfHeight: rec.extents[i * 2 + 1]!,
      layer: rec.layers[i]!,
    });
  }

  const joints: JointAnchor[] = [];
  const jointAngles = new Map<string, number>();
  for (let i = 0; i < nj; i++) {
    const o = (f * nj + i) * 2;
    joints.push({
      id: rec.joints[i]!,
      x: rec.anchors[o]!,
      y: rec.anchors[o + 1]!,
      layer: rec.jointLayers[i]!,
    });
    jointAngles.set(rec.joints[i]!, rec.jointAngles[f * nj + i]!);
  }

  return {
    time: timeAt(rec, f),
    steps: f * Math.round(240 / rec.hz),
    bodies,
    joints,
    torsoHeight: rec.torsoHeight[f]!,
    // Recomputing `fallen` from the recording would need the standing height; the trial
    // already decided, and it stopped recording at the frame it decided on.
    fallen: rec.fell && f === rec.frames - 1,
    distance: rec.distance[f]!,
    jointAngles,
  };
}

/** Whether a given foot was on the ground at a frame. Index 0 is left, 1 is right. */
export function contactAt(rec: Recording, frame: number, foot: 0 | 1): boolean {
  const f = Math.max(0, Math.min(rec.frames - 1, Math.round(frame)));
  return rec.contact[f * 2 + foot] === 1;
}

/* ---------------- building one ---------------- */

/**
 * Mutable buffer a trial fills in. Preallocated to the requested length and trimmed at the
 * end, so a recorded trial allocates a fixed amount once rather than growing arrays as it
 * goes — and an unrecorded trial never constructs one at all.
 */
export interface Recorder {
  push(snap: Snapshot, leftDown: boolean, rightDown: boolean): void;
  finish(fell: boolean): Recording;
}

export function createRecorder(snap: Snapshot, capacityFrames: number): Recorder {
  const bodies = snap.bodies.map((b) => b.id);
  const joints = snap.joints.map((j) => j.id);
  const nb = bodies.length;
  const nj = joints.length;
  const cap = Math.max(1, capacityFrames);

  const extents = new Float32Array(nb * 2);
  snap.bodies.forEach((b, i) => {
    extents[i * 2] = b.halfWidth;
    extents[i * 2 + 1] = b.halfHeight;
  });

  const pose = new Float32Array(cap * nb * 3);
  const anchors = new Float32Array(cap * nj * 2);
  const jointAngles = new Float32Array(cap * nj);
  const contact = new Uint8Array(cap * 2);
  const distance = new Float32Array(cap);
  const torsoHeight = new Float32Array(cap);
  let frames = 0;

  return {
    push(s, leftDown, rightDown) {
      if (frames >= cap) return;
      const f = frames;
      for (let i = 0; i < nb; i++) {
        const b = s.bodies[i];
        if (!b) continue;
        const o = (f * nb + i) * 3;
        pose[o] = b.x;
        pose[o + 1] = b.y;
        pose[o + 2] = b.angle;
      }
      for (let i = 0; i < nj; i++) {
        const j = s.joints[i];
        if (!j) continue;
        anchors[(f * nj + i) * 2] = j.x;
        anchors[(f * nj + i) * 2 + 1] = j.y;
        jointAngles[f * nj + i] = s.jointAngles.get(j.id) ?? 0;
      }
      contact[f * 2] = leftDown ? 1 : 0;
      contact[f * 2 + 1] = rightDown ? 1 : 0;
      distance[f] = s.distance;
      torsoHeight[f] = s.torsoHeight;
      frames++;
    },

    finish(fell) {
      // Trimmed with `slice`, which copies. A trial that fell at 1 s of 4 would otherwise
      // hand the renderer three seconds of zeroes and a scrubber that seeks into them.
      return {
        bodies,
        extents,
        layers: snap.bodies.map((b) => b.layer),
        joints,
        jointLayers: snap.joints.map((j) => j.layer),
        hz: RECORD_HZ,
        frames,
        pose: pose.slice(0, frames * nb * 3),
        anchors: anchors.slice(0, frames * nj * 2),
        jointAngles: jointAngles.slice(0, frames * nj),
        contact: contact.slice(0, frames * 2),
        distance: distance.slice(0, frames),
        torsoHeight: torsoHeight.slice(0, frames),
        fell,
      };
    },
  };
}
