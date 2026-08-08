/**
 * Headless smoke test: build the biped, drop it, print what happens.
 *
 * This exists because invariants 3 and 4 make it possible — the sim touches no DOM, so it
 * runs under plain Node. Verifying physics without a browser is much faster than
 * verifying it with one, and this file is the seed of the golden test that arrives with
 * the genetic algorithm in slice 2.
 *
 *   npm run sim
 */

import { Rng, simpleBiped } from '../packages/evolution/src/index.ts';
import { initPhysics, spawnFalling, TIMESTEP } from '../packages/sim/src/index.ts';

const SEED = 4417;
const SECONDS = 3;

await initPhysics();

const morph = simpleBiped();
const sim = spawnFalling(morph, new Rng(SEED));

console.log(`morphology   ${morph.name}: ${morph.segments.length} segments, ${morph.joints.length} joints`);
console.log(`timestep     ${TIMESTEP.toFixed(6)} s  (${Math.round(1 / TIMESTEP)} Hz)`);
console.log(`seed         ${SEED}\n`);
console.log('    time     torso y   state');

const totalSteps = Math.round(SECONDS / TIMESTEP);
let fellAt: number | null = null;

for (let i = 0; i <= totalSteps; i++) {
  if (i % 60 === 0) {
    const s = sim.snapshot();
    console.log(
      `  ${s.time.toFixed(2).padStart(5)} s   ${s.torsoHeight.toFixed(3).padStart(6)} m   ${
        s.fallen ? 'fallen' : 'upright'
      }`,
    );
  }
  const s = sim.snapshot();
  if (fellAt === null && s.fallen) fellAt = s.time;
  if (i < totalSteps) sim.step();
}

const final = sim.snapshot();
console.log(`\nfell after   ${fellAt === null ? 'never' : `${fellAt.toFixed(2)} s`}`);
console.log(`final torso  ${final.torsoHeight.toFixed(4)} m`);
console.log(`steps run    ${final.steps}`);

// Determinism check: the same seed must produce the same number, every time, forever.
const replay = spawnFalling(morph, new Rng(SEED));
replay.stepMany(totalSteps);
const same = Math.abs(replay.snapshot().torsoHeight - final.torsoHeight) < 1e-12;
console.log(`replay match ${same ? 'yes — deterministic' : 'NO — INVARIANT 2 BROKEN'}`);

sim.dispose();
replay.dispose();

if (!same) process.exit(1);
