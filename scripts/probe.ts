/**
 * Tuning probe. Not a test — a throwaway harness for answering "what do these numbers
 * actually do", kept because that question recurs every time the controller changes.
 *
 *   node --experimental-strip-types scripts/probe.ts
 */

import { Rng, defaultGait, simpleBiped, type GaitParams } from '../packages/evolution/src/index.ts';
import { initPhysics, Sim, stepControlled, TIMESTEP } from '../packages/sim/src/index.ts';

await initPhysics();
const morph = simpleBiped();
const SECONDS = 6;
const steps = Math.round(SECONDS / TIMESTEP);

function run(params: GaitParams, stiffness: number, damping: number, tilt = 0) {
  const sim = new Sim(morph, { tilt, motorStiffness: stiffness, motorDamping: damping });
  const scratch = new Map<string, number>();
  let fellAt: number | null = null;
  let peak = 0;
  let minHeight = Infinity;
  for (let i = 0; i <= steps; i++) {
    const s = sim.snapshot();
    if (fellAt === null && s.fallen) fellAt = s.time;
    peak = Math.max(peak, Math.abs(s.distance));
    minHeight = Math.min(minHeight, s.torsoHeight);
    if (i < steps) stepControlled(sim, morph, params, 1, scratch);
  }
  const f = sim.snapshot();
  sim.dispose();
  return { distance: f.distance, fellAt, minHeight, height: f.torsoHeight };
}

const still = (): GaitParams => ({
  frequency: 1,
  hip: { amplitude: 0, phase: 0, centre: 0 },
  knee: { amplitude: 0, phase: 0, centre: 0 },
  ankle: { amplitude: 0, phase: 0, centre: 0 },
});

const crouch = (): GaitParams => ({
  ...still(),
  hip: { amplitude: 0, phase: 0, centre: 0.1 },
  knee: { amplitude: 0, phase: 0, centre: -0.35 },
});

console.log('=== can the motors hold a pose at all? (amplitude 0) ===');
console.log('  gains          pose      final y   min y    fell');
for (const [k, d] of [[100, 10], [400, 40], [1200, 70], [4000, 130]] as const) {
  for (const [name, p] of [['straight', still()], ['crouched', crouch()]] as const) {
    const r = run(p, k, d);
    console.log(
      `  k=${String(k).padStart(4)} d=${String(d).padStart(3)}  ${name.padEnd(9)} ` +
      `${r.height.toFixed(3)} m   ${r.minHeight.toFixed(3)} m  ${r.fellAt === null ? 'no' : r.fellAt.toFixed(2) + ' s'}`,
    );
  }
}

console.log('\n=== default gait across gains ===');
console.log('  gains          distance   fell');
for (const [k, d] of [[400, 40], [1200, 70], [2500, 100], [4000, 130]] as const) {
  const r = run(defaultGait(), k, d);
  console.log(
    `  k=${String(k).padStart(4)} d=${String(d).padStart(3)}  ${r.distance.toFixed(3).padStart(7)} m   ` +
    `${r.fellAt === null ? 'never' : r.fellAt.toFixed(2) + ' s'}`,
  );
}

console.log('\n=== a coarse sweep for anything that walks (k=2500 d=100) ===');
const rng = new Rng(11);
let best = { d: 0, p: null as GaitParams | null };
for (let i = 0; i < 400; i++) {
  const p: GaitParams = {
    frequency: rng.range(0.8, 2.4),
    hip: { amplitude: rng.range(0.1, 0.7), phase: rng.range(0, 6.28), centre: rng.range(-0.3, 0.3) },
    knee: { amplitude: rng.range(0.1, 0.8), phase: rng.range(0, 6.28), centre: rng.range(-0.6, 0) },
    ankle: { amplitude: rng.range(0, 0.4), phase: rng.range(0, 6.28), centre: rng.range(-0.3, 0.3) },
  };
  const r = run(p, 2500, 100);
  if (r.distance > best.d) best = { d: r.distance, p };
}
console.log(`  best of 400 random gaits: ${best.d.toFixed(3)} m`);
if (best.p) console.log('  ' + JSON.stringify(best.p, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
