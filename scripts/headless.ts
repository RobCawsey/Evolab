/**
 * Headless smoke test: build the biped, drive it with the default gait, print what
 * happens.
 *
 * This exists because ground rules 3 and 4 make it possible — the sim touches no DOM, so
 * it runs under plain Node. Verifying physics without a browser is much faster than
 * verifying it with one, and this file is the seed of the golden test that arrives with
 * the genetic algorithm in slice 2.
 *
 *   npm run sim
 */

import { Rng, defaultGait, simpleBiped, type GaitParams } from '../packages/evolution/src/index.ts';
import { initPhysics, Sim, stepControlled, TIMESTEP } from '../packages/sim/src/index.ts';

const SEED = 4417;
const SECONDS = 8;

await initPhysics();

const morph = simpleBiped();
const gait = defaultGait();
const totalSteps = Math.round(SECONDS / TIMESTEP);

console.log(`morphology   ${morph.name}: ${morph.segments.length} segments, ${morph.joints.length} joints`);
console.log(`timestep     ${TIMESTEP.toFixed(6)} s  (${Math.round(1 / TIMESTEP)} Hz)`);
console.log(`gait         ${gait.frequency.toFixed(2)} Hz, hip A=${gait.hip.amplitude.toFixed(2)} ` +
  `knee A=${gait.knee.amplitude.toFixed(2)} ankle A=${gait.ankle.amplitude.toFixed(2)}`);
console.log(`seed         ${SEED}\n`);

/** Run one trial and report how it went. */
function trial(params: GaitParams, seed: number, label: string, verbose = false): { distance: number; fellAt: number | null } {
  const sim = new Sim(morph, { tilt: new Rng(seed).range(-0.02, 0.02) });
  const scratch = new Map<string, number>();
  let fellAt: number | null = null;
  let peak = 0;

  if (verbose) console.log('    time    distance   torso y   state');

  for (let i = 0; i <= totalSteps; i++) {
    const s = sim.snapshot();
    if (fellAt === null && s.fallen) fellAt = s.time;
    peak = Math.max(peak, s.distance);
    if (verbose && i % 240 === 0) {
      console.log(
        `  ${s.time.toFixed(2).padStart(5)} s  ${s.distance.toFixed(3).padStart(7)} m  ` +
        `${s.torsoHeight.toFixed(3).padStart(6)} m   ${s.fallen ? 'fallen' : 'upright'}`,
      );
    }
    if (i < totalSteps) stepControlled(sim, morph, params, 1, scratch);
  }

  const final = sim.snapshot();
  sim.dispose();
  if (verbose) {
    console.log(`\n${label}`);
    console.log(`  distance   ${final.distance.toFixed(3)} m   (peak ${peak.toFixed(3)} m)`);
    console.log(`  fell after ${fellAt === null ? 'never' : `${fellAt.toFixed(2)} s`}`);
  }
  return { distance: final.distance, fellAt };
}

/**
 * The best gait found so far, by a 120-generation population search over the same
 * parameter space the sliders expose. Kept as a reference point: slice 2's genetic
 * algorithm should beat this comfortably, and if it does not, something is wrong with the
 * GA rather than with the physics.
 */
const BEST_KNOWN: GaitParams = {
  frequency: 0.6,
  hip: { amplitude: 0.734, phase: 4.451, centre: 0.061 },
  knee: { amplitude: 0.624, phase: 5.962, centre: -0.189 },
  ankle: { amplitude: 0.419, phase: 4.31, centre: 0.134 },
};

trial(gait, SEED, 'default gait', true);

const bk = trial(BEST_KNOWN, SEED, 'best known', false);
console.log(`\nbest known gait`);
console.log(`  distance   ${bk.distance.toFixed(3)} m`);
console.log(`  fell after ${bk.fellAt === null ? 'never' : `${bk.fellAt.toFixed(2)} s`}`);

// Determinism: the same seed and the same parameters must produce the same number, every
// time, forever. This is the smallest form of the slice-2 golden test.
const a = trial(gait, SEED, 'replay a');
const b = trial(gait, SEED, 'replay b');
const same = Math.abs(a.distance - b.distance) < 1e-12;
console.log(`\nreplay match ${same ? 'yes — deterministic' : 'NO — GROUND RULE 2 BROKEN'}`);

if (!same) process.exit(1);
