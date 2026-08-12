/**
 * Run one genome for one trial and return numbers. No rendering, no search.
 *
 * This is the inner loop of the whole project: from slice 2 onward it runs tens of
 * thousands of times per study, so the two things that matter are that it disposes its
 * world and that it stops early when the robot is already on the floor.
 *
 * From slice 9 it can also record the trajectory, but only when asked. `record` unset is the
 * path the search takes and it allocates nothing beyond what it always did.
 */

import {
  Rng,
  decodeGenome,
  gaitTargets,
  type GaitParams,
  type Genome,
  type Morphology,
  type TrialResult,
} from '@evolab/evolution';
import { CONTROL_EVERY } from './control.ts';
import { RECORD_HZ, createRecorder, type Recorder, type Recording } from './record.ts';
import type { TerrainSpec } from './terrain.ts';
import { Sim, TIMESTEP } from './world.ts';

export interface TrialOptions {
  /** Seeds the small initial tilt, so a gait is tested against a real perturbation. */
  readonly seed: number;
  readonly seconds: number;
  /** Peak initial lean, radians. Zero makes trials noiseless but flatters fragile gaits. */
  readonly tiltRange?: number;
  /**
   * Capture the trajectory as well as the score.
   *
   * **Off by default and it must stay that way.** The search runs this function tens of
   * thousands of times per study; recording is for the one genome someone is looking at.
   * With it unset nothing extra is allocated — no recorder, no buffers, not even the
   * contact booleans being written anywhere.
   */
  readonly record?: boolean;
  /**
   * The ground. Absent means the flat floor, which is what the search always runs on.
   *
   * Terrain belongs to the task suite (slice 14), never to evolution: a population scored on
   * bumpy ground is a different search, and the behaviour archive's descriptors were measured
   * on flat.
   */
  readonly terrain?: TerrainSpec;
  /** Fore/aft impulses at the torso, newton-seconds, applied at a time in seconds. */
  readonly impulses?: readonly { readonly at: number; readonly x: number }[];
}

/** A trial that was asked to remember what it did. */
export type RecordedTrial = TrialResult & { readonly recording: Recording };

const DEFAULT_TILT_RANGE = 0.02;

/**
 * How close the lowest corner of a foot must come to the ground to count as standing on it.
 *
 * Five millimetres, chosen by measurement rather than by taste. Swept against the reference
 * champion (seed 4417, 30 generations, 5.96 m), the touchdown count is a flat 7 per foot for
 * every threshold from 1 mm to 10 mm and collapses to 3 at 20 mm, where separate steps start
 * merging into one. Duty factor drifts 0.78 → 0.84 across that flat region, so the number is
 * not threshold-free, but it is stable well either side of the value picked. That gait lifts
 * its feet 58 mm and 135 mm, an order of magnitude clear of any of it.
 *
 * Deliberately not a collision-event subscription. A geometry test on the snapshot the trial
 * already takes is cheaper and far easier to reason about than draining an event queue.
 *
 * Slice 14 is the "revisit when the floor stops being flat" this comment used to promise. The
 * test is now against `sim.groundAt(x)` rather than against zero, which is the easy half of
 * what was predicted: the lowest corner of an oriented box against a *locally* flat ground is
 * the same arithmetic, evaluated at a different datum. The half that stays hard is a foot
 * spanning a step edge, where the corner nearest the ground is not the lowest one — at a 2 cm
 * sample spacing and a 12 cm riser that costs at most one frame of contact per step, which is
 * below the threshold's own noise floor.
 */
const CONTACT_EPSILON = 0.005;

/** Lowest corner of an oriented box. The feet are boxes; nothing here assumes they are level. */
function lowestCorner(y: number, angle: number, halfWidth: number, halfHeight: number): number {
  return y - (Math.abs(halfWidth * Math.sin(angle)) + Math.abs(halfHeight * Math.cos(angle)));
}

/** Accumulates stance time and touchdown positions for one foot across a trial. */
interface FootTrack {
  down: boolean;
  stanceFrames: number;
  /** Torso displacement at each touchdown. Consecutive differences are the strides. */
  readonly touchdowns: number[];
}

function newTrack(): FootTrack {
  return { down: false, stanceFrames: 0, touchdowns: [] };
}

/** Mean gap between consecutive touchdowns, or 0 if the foot never landed twice. */
function meanStride(touchdowns: readonly number[]): number {
  if (touchdowns.length < 2) return 0;
  const first = touchdowns[0]!;
  const last = touchdowns[touchdowns.length - 1]!;
  return (last - first) / (touchdowns.length - 1);
}

/**
 * How many physics steps between recorded samples. Four, giving 60 Hz from a 240 Hz sim —
 * the same cadence the controller runs at, so a recorded frame always lands on a tick where
 * the joint targets had just been set rather than midway through the motors chasing them.
 */
const RECORD_EVERY = Math.round(1 / TIMESTEP / RECORD_HZ);

/** Run a trial from already-decoded controller parameters. */
export function evaluateGait(
  morph: Morphology,
  params: GaitParams,
  opts: TrialOptions & { readonly record: true },
): RecordedTrial;
export function evaluateGait(
  morph: Morphology,
  params: GaitParams,
  opts: TrialOptions,
): TrialResult;
export function evaluateGait(
  morph: Morphology,
  params: GaitParams,
  opts: TrialOptions,
): TrialResult | RecordedTrial {
  const steps = Math.round(opts.seconds / TIMESTEP);
  const tiltRange = opts.tiltRange ?? DEFAULT_TILT_RANGE;
  const sim = new Sim(morph, {
    tilt: new Rng(opts.seed).range(-tiltRange, tiltRange),
    ...(opts.terrain === undefined ? {} : { terrain: opts.terrain }),
  });
  // Impulses are consumed in order, so a task can queue several and each fires once. Compared
  // against the step index rather than the clock so a trial stays bit-reproducible.
  const impulses = opts.impulses ? [...opts.impulses].sort((a, b) => a.at - b.at) : [];
  let nextImpulse = 0;
  const targets = new Map<string, number>();
  const previous = new Map<string, number>();

  let effort = 0;
  let uprightTime = 0;
  let fell = false;
  let distance = 0;
  let duration = 0;

  const tracks = new Map<string, FootTrack>([
    ['footL', newTrack()],
    ['footR', newTrack()],
  ]);
  let frames = 0;
  let recorder: Recorder | null = null;

  try {
    for (let i = 0; i <= steps; i++) {
      const snap = sim.snapshot();
      duration = snap.time;
      distance = snap.distance;

      // Gait descriptors are sampled before the fall check, so the frame the robot lands on
      // still counts. They describe how it moved for as long as it was moving.
      frames++;
      for (const body of snap.bodies) {
        const track = tracks.get(body.id);
        if (!track) continue;
        const down =
          lowestCorner(body.y, body.angle, body.halfWidth, body.halfHeight)
          - sim.groundAt(body.x) <= CONTACT_EPSILON;
        // Rising edge only. A foot that stays down is one touchdown, not four hundred.
        if (down && !track.down && i > 0) track.touchdowns.push(snap.distance);
        if (down) track.stanceFrames++;
        track.down = down;
      }

      // Recorded before the fall check, for the same reason: the frame it goes down on is
      // the one worth watching. The recorder is built from the first snapshot because that
      // is where the body and joint ids come from.
      if (opts.record && i % RECORD_EVERY === 0) {
        recorder ??= createRecorder(snap, Math.floor(steps / RECORD_EVERY) + 1);
        recorder.push(snap, tracks.get('footL')!.down, tracks.get('footR')!.down);
      }

      if (snap.fallen) {
        fell = true;
        break;
      }
      uprightTime = snap.time;

      // Total joint travel. Accumulated from the actual achieved angles rather than the
      // commanded ones, so a motor that cannot keep up is not charged for effort it never
      // spent. See the note on TrialResult.effort for why this is not joules.
      for (const [id, angle] of snap.jointAngles) {
        const prev = previous.get(id);
        if (prev !== undefined) effort += Math.abs(angle - prev);
        previous.set(id, angle);
      }

      if (i < steps) {
        // Before the step, so the impulse is integrated by the step it is scheduled for.
        while (nextImpulse < impulses.length && impulses[nextImpulse]!.at <= snap.time) {
          sim.applyTorsoImpulse(impulses[nextImpulse]!.x);
          nextImpulse++;
        }
        if (sim.steps % CONTROL_EVERY === 0) {
          gaitTargets(morph, params, sim.time, sim.controlState(), targets);
          sim.setJointTargets(targets);
        }
        sim.step();
      }
    }
    // Averaged over the feet that actually completed a cycle. A one-legged hop is a real
    // gait and its stride is the hopping foot's, not half of it.
    const strides = [...tracks.values()].map((t) => meanStride(t.touchdowns)).filter((s) => s > 0);
    const strideLength = strides.length
      ? strides.reduce((a, b) => a + b, 0) / strides.length
      : 0;
    const stance = [...tracks.values()].reduce((a, t) => a + t.stanceFrames, 0);
    const dutyFactor = frames > 0 ? stance / (frames * tracks.size) : 0;

    const result: TrialResult = {
      distance, uprightTime, effort, fell, duration, strideLength, dutyFactor,
    };
    return recorder === null ? result : { ...result, recording: recorder.finish(fell) };
  } finally {
    // Rapier allocates in WASM memory and is not garbage collected. Leaking worlds here is
    // the single most likely cause of a run that gets mysteriously slower and then dies.
    sim.dispose();
  }
}

/** Run a trial from a genome. The form the genetic algorithm uses. */
export function evaluate(
  morph: Morphology,
  genome: Genome,
  opts: TrialOptions & { readonly record: true },
): RecordedTrial;
export function evaluate(
  morph: Morphology,
  genome: Genome,
  opts: TrialOptions,
): TrialResult;
export function evaluate(
  morph: Morphology,
  genome: Genome,
  opts: TrialOptions,
): TrialResult | RecordedTrial {
  return evaluateGait(morph, decodeGenome(genome), opts);
}

/**
 * Bind a morphology and trial options into the `Evaluator` shape the island expects.
 *
 *   evolve(island, 30, makeEvaluator(morph, { seconds: 4 }))
 */
export function makeEvaluator(
  morph: Morphology,
  opts: Omit<TrialOptions, 'seed'>,
): (genome: Genome, seed: number) => TrialResult {
  return (genome, seed) => evaluate(morph, genome, { ...opts, seed });
}
