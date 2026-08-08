/**
 * The parametric controller: a per-joint Fourier series over gait phase, truncated to one
 * harmonic.
 *
 * This is the default encoding for the whole project (§3 of the design document) because
 * every parameter maps to a visible feature of a curve — you can point at a bump in the
 * knee trace and name the gene that made it. It is strictly open loop: a function of time
 * and nothing else. No sensors, no feedback.
 *
 * Pure. No DOM, no Rapier, no randomness.
 */

import type { Morphology } from './morphology.ts';

export type JointKind = 'hip' | 'knee' | 'ankle';

export interface JointGait {
  /** Peak deviation from `centre`, radians. */
  readonly amplitude: number;
  /** Phase offset within the gait cycle, radians. */
  readonly phase: number;
  /** Angle the oscillation is centred on, radians. */
  readonly centre: number;
}

export interface GaitParams {
  /** Gait cycle frequency, Hz. One cycle is one full stride (both legs). */
  readonly frequency: number;
  /**
   * Balance feedback: radians of extra hip flexion per radian of forward torso pitch.
   *
   * The one term that is not a function of time. Without it the controller has no
   * world-frame reference at all and cannot know the robot is tipping, let alone correct
   * it — see "the open-loop ceiling" in docs/implementation.md. Setting it to 0 restores
   * the strictly open-loop controller, which is worth doing once to watch what happens.
   */
  readonly balanceGain: number;
  readonly hip: JointGait;
  readonly knee: JointGait;
  readonly ankle: JointGait;
}

/**
 * The robot's own sense of which way is up. The only state the controller sees.
 */
export interface ControlState {
  /** Torso pitch, radians. Positive is leaning forward. */
  readonly pitch: number;
  /** Rate of change of pitch, rad/s. Positive is falling forward. */
  readonly pitchRate: number;
}

/**
 * Lead time for the balance term, seconds.
 *
 * Proportional feedback alone lags — by the time a pitch error is large enough to correct,
 * the robot already has the angular momentum to keep going, so it overshoots and
 * oscillates. Feeding back `pitch + LEAD · pitchRate` is a first-order prediction of where
 * the torso will be in 0.12 s, which damps the response.
 *
 * Deliberately a constant rather than a second gene: one tunable number is the whole point
 * of choosing this option, and a fixed lead sets a sensible damping ratio for free.
 */
export const PITCH_LEAD = 0.12;

/** No balance feedback and no state — for callers that only want the periodic part. */
export const STILL: ControlState = { pitch: 0, pitchRate: 0 };

/**
 * Bounds for every parameter. Used for slider extents now, and — unchanged — as the
 * decode ranges for the genome in slice 2. Keeping one source of truth means a gait found
 * by hand and a gait found by evolution live in exactly the same space.
 */
export const GAIT_RANGES = {
  frequency: [0.5, 3.0],
  balanceGain: [-2, 2],
  hip: { amplitude: [0, 0.8], phase: [0, 2 * Math.PI], centre: [-0.5, 0.5] },
  knee: { amplitude: [0, 0.9], phase: [0, 2 * Math.PI], centre: [-0.8, 0.1] },
  ankle: { amplitude: [0, 0.5], phase: [0, 2 * Math.PI], centre: [-0.4, 0.4] },
} as const;

export const JOINT_KINDS: readonly JointKind[] = ['hip', 'knee', 'ankle'];

/**
 * A starting point that is upright and rhythmic but does not walk. Finding something
 * better than this by hand is the exercise of slice 1; finding something better than
 * *that* is the job of slice 2.
 */
export function defaultGait(): GaitParams {
  return {
    frequency: 1.4,
    balanceGain: 0.5,
    hip: { amplitude: 0.4, phase: 0, centre: 0.1 },
    knee: { amplitude: 0.5, phase: 2.2, centre: -0.35 },
    ankle: { amplitude: 0.2, phase: 3.6, centre: 0 },
  };
}

/** Left and right run half a cycle apart. This is what makes it a gait and not a hop. */
const SIDE_PHASE = { L: 0, R: Math.PI } as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Target angle for every actuated joint at time `t`, keyed by joint id.
 *
 * Targets are clamped to each joint's limits here rather than in the simulator, because
 * the limits are a property of the morphology and this module already has it. The
 * simulator applies numbers; it does not decide them.
 *
 * `out` may be supplied to avoid allocating a Map on every control tick — this runs
 * 60 times per simulated second, and from slice 2 that is millions of times per run.
 */
export function gaitTargets(
  morph: Morphology,
  params: GaitParams,
  t: number,
  state: ControlState = STILL,
  out?: Map<string, number>,
): Map<string, number> {
  const targets = out ?? new Map<string, number>();
  targets.clear();

  const cyclePhase = 2 * Math.PI * params.frequency * t;

  // One number, shared by both hips: how far forward the torso is predicted to be, times
  // the gain. Driving the thighs forward against a forward lean pushes the torso back
  // upright by reaction — the hip balance strategy, in one line.
  const correction = params.balanceGain * (state.pitch + PITCH_LEAD * state.pitchRate);

  for (const joint of morph.joints) {
    const g = params[joint.kind];
    let angle = g.centre + g.amplitude * Math.sin(cyclePhase + g.phase + SIDE_PHASE[joint.side]);
    if (joint.kind === 'hip') angle += correction;
    targets.set(joint.id, clamp(angle, joint.limits[0], joint.limits[1]));
  }

  return targets;
}

/** Position within the current gait cycle, 0..1. For the HUD and, later, gait diagrams. */
export function gaitPhase(params: GaitParams, t: number): number {
  const cycles = params.frequency * t;
  return cycles - Math.floor(cycles);
}

/** Structural clone with one joint's parameter replaced. Used by the slider panel. */
export function withJointParam(
  params: GaitParams,
  kind: JointKind,
  key: keyof JointGait,
  value: number,
): GaitParams {
  return { ...params, [kind]: { ...params[kind], [key]: value } };
}
