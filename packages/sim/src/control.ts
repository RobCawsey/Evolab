/**
 * Driving a Sim with a controller at a fixed control rate.
 *
 * The control loop runs at 60 Hz while physics runs at 240 Hz. Real actuators do not
 * update every 4 ms, and decoupling the two means the physics rate can change later
 * without changing how a gait behaves.
 */

import { gaitTargets, type GaitParams, type Morphology } from '@evolab/evolution';
import { Sim } from './world.ts';

/** Physics steps per control tick. 240 Hz / 4 = 60 Hz control. */
export const CONTROL_EVERY = 4;

/**
 * Advance the simulation by `steps` physics steps, re-evaluating the controller every
 * `CONTROL_EVERY` of them.
 *
 * The targets Map is reused across ticks. This runs 60 times per simulated second, and
 * from slice 2 that is millions of times per run — allocating a Map each tick would show
 * up in a profile.
 */
export function stepControlled(
  sim: Sim,
  morph: Morphology,
  params: GaitParams,
  steps = 1,
  scratch?: Map<string, number>,
): void {
  const targets = scratch ?? new Map<string, number>();
  for (let i = 0; i < steps; i++) {
    if (sim.steps % CONTROL_EVERY === 0) {
      gaitTargets(morph, params, sim.time, targets);
      sim.setJointTargets(targets);
    }
    sim.step();
  }
}
