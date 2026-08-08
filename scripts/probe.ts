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
const SECS = 10;
const steps = Math.round(SECS / TIMESTEP);
const scratch = new Map<string, number>();

function run(p: GaitParams, tilt = 0) {
  const sim = new Sim(morph, { tilt });
  let upright = 0, peak = 0, fellAt: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const s = sim.snapshot();
    if (s.fallen) { fellAt = s.time; break; }
    upright = s.time;
    peak = Math.max(peak, s.distance);
    if (i < steps) stepControlled(sim, morph, p, 1, scratch);
  }
  sim.dispose();
  return { peak, upright, fellAt, fitness: peak + 0.5 * (upright / SECS) };
}

const still = (gain: number): GaitParams => ({
  frequency: 1,
  balanceGain: gain,
  hip: { amplitude: 0, phase: 0, centre: 0 },
  knee: { amplitude: 0, phase: 0, centre: 0 },
  ankle: { amplitude: 0, phase: 0, centre: 0 },
});

console.log('=== can it stand? (no oscillation, balance gain only, 10 s) ===');
console.log('  gain   tilt     upright   fell');
for (const gain of [0, 0.5, 1, 1.5, 2.5, 4]) {
  for (const tilt of [0, 0.03]) {
    const r = run(still(gain), tilt);
    console.log(
      `  ${gain.toFixed(1).padStart(4)}   ${tilt.toFixed(2)}   ` +
      `${r.upright.toFixed(2).padStart(6)} s   ${r.fellAt === null ? 'never' : r.fellAt.toFixed(2) + ' s'}`,
    );
  }
}

console.log('\n=== default gait vs balance gain ===');
console.log('  gain   distance   upright   fell');
for (const gain of [0, 0.5, 1, 1.5, 2.5, 4]) {
  const r = run({ ...defaultGait(), balanceGain: gain });
  console.log(
    `  ${gain.toFixed(1).padStart(4)}   ${r.peak.toFixed(2).padStart(7)} m   ` +
    `${r.upright.toFixed(2).padStart(6)} s   ${r.fellAt === null ? 'never' : r.fellAt.toFixed(2) + ' s'}`,
  );
}

console.log('\n=== population search, 120 generations, 11 parameters ===');
const rng = new Rng(99);
const rnd = (): GaitParams => ({
  frequency: rng.range(0.6, 2.6),
  balanceGain: rng.range(0, 5),
  hip: { amplitude: rng.range(0, 0.8), phase: rng.range(0, 6.283), centre: rng.range(-0.5, 0.5) },
  knee: { amplitude: rng.range(0, 0.9), phase: rng.range(0, 6.283), centre: rng.range(-0.8, 0.1) },
  ankle: { amplitude: rng.range(0, 0.5), phase: rng.range(0, 6.283), centre: rng.range(-0.4, 0.4) },
});

let pop = Array.from({ length: 24 }, () => { const p = rnd(); return { p, ...run(p) }; });
for (let gen = 1; gen <= 120; gen++) {
  pop.sort((a, b) => b.fitness - a.fitness);
  const next = pop.slice(0, 2);
  const s = 0.18 * (1 - gen / 150) + 0.02;
  const mut = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v + rng.normal() * s * (hi - lo)));
  while (next.length < 24) {
    const pick = () => [pop[rng.int(24)]!, pop[rng.int(24)]!, pop[rng.int(24)]!]
      .sort((x, y) => y.fitness - x.fitness)[0]!.p;
    const c = pick();
    const p: GaitParams = {
      frequency: mut(c.frequency, .6, 2.6),
      balanceGain: mut(c.balanceGain, 0, 5),
      hip: { amplitude: mut(c.hip.amplitude,0,.8), phase: mut(c.hip.phase,0,6.283), centre: mut(c.hip.centre,-.5,.5) },
      knee: { amplitude: mut(c.knee.amplitude,0,.9), phase: mut(c.knee.phase,0,6.283), centre: mut(c.knee.centre,-.8,.1) },
      ankle: { amplitude: mut(c.ankle.amplitude,0,.5), phase: mut(c.ankle.phase,0,6.283), centre: mut(c.ankle.centre,-.4,.4) },
    };
    next.push({ p, ...run(p) });
  }
  pop = next;
  if (gen % 20 === 0) {
    const b = pop.reduce((x, y) => (y.fitness > x.fitness ? y : x));
    console.log(`  gen ${String(gen).padStart(3)}  fitness ${b.fitness.toFixed(3)}  ` +
      `dist ${b.peak.toFixed(2)} m  upright ${b.upright.toFixed(2)} s  gain ${b.p.balanceGain.toFixed(2)}`);
  }
}
const best = pop.reduce((x, y) => (y.fitness > x.fitness ? y : x));
console.log('\nbest: ' + JSON.stringify(best.p, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
