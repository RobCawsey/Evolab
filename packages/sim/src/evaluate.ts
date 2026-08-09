/**
 * Run one genome for one trial and return numbers. No rendering, no recording, no search.
 *
 * This is the inner loop of the whole project: from slice 2 onward it runs tens of
 * thousands of times per study, so the two things that matter are that it disposes its
 * world and that it stops early when the robot is already on the floor.
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
import { Sim, TIMESTEP } from './world.ts';

export interface TrialOptions {
  /** Seeds the small initial tilt, so a gait is tested against a real perturbation. */
  readonly seed: number;
  readonly seconds: number;
  /** Peak initial lean, radians. Zero makes trials noiseless but flatters fragile gaits. */
  readonly tiltRange?: number;
}

const DEFAULT_TILT_RANGE = 0.02;

/** Run a trial from already-decoded controller parameters. */
export function evaluateGait(
  morph: Morphology,
  params: GaitParams,
  opts: TrialOptions,
): TrialResult {
  const steps = Math.round(opts.seconds / TIMESTEP);
  const tiltRange = opts.tiltRange ?? DEFAULT_TILT_RANGE;
  const sim = new Sim(morph, { tilt: new Rng(opts.seed).range(-tiltRange, tiltRange) });
  const targets = new Map<string, number>();
  const previous = new Map<string, number>();

  let effort = 0;
  let uprightTime = 0;
  let fell = false;
  let distance = 0;
  let duration = 0;

  try {
    for (let i = 0; i <= steps; i++) {
      const snap = sim.snapshot();
      duration = snap.time;
      distance = snap.distance;

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
        if (sim.steps % CONTROL_EVERY === 0) {
          gaitTargets(morph, params, sim.time, sim.controlState(), targets);
          sim.setJointTargets(targets);
        }
        sim.step();
      }
    }
    return { distance, uprightTime, effort, fell, duration };
  } finally {
    // Rapier allocates in WASM memory and is not garbage collected. Leaking worlds here is
    // the single most likely cause of a run that gets mysteriously slower and then dies.
    sim.dispose();
  }
}

/** Run a trial from a genome. The form the genetic algorithm uses. */
export function evaluate(morph: Morphology, genome: Genome, opts: TrialOptions): TrialResult {
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
