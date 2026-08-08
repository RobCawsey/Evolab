/**
 * Slice 0 — "it falls over".
 *
 * A jointed 2D biped ragdolls onto a floor. No controller, no genetic algorithm, no UI
 * beyond a HUD. The point is to prove the physics and the render loop and nothing else.
 */

import { Rng, simpleBiped } from '@evolab/evolution';
import { initPhysics, spawnFalling, TIMESTEP, type Sim } from '@evolab/sim';
import { draw } from './render/draw.ts';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');

const hud = {
  seed: document.getElementById('v-seed') as HTMLElement,
  time: document.getElementById('v-time') as HTMLElement,
  steps: document.getElementById('v-steps') as HTMLElement,
  height: document.getElementById('v-height') as HTMLElement,
  state: document.getElementById('v-state') as HTMLElement,
};

const morph = simpleBiped();

// ?seed=42 and ?paused=1 — so a specific fall can be reproduced and inspected frame by
// frame without touching the code. Cheap, and useful every time physics misbehaves.
const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));

let sim: Sim | null = null;
let seed = Number.isFinite(seedParam) && params.has('seed') ? seedParam : 4417;
let paused = params.get('paused') === '1';

/** Real time owed to the simulation but not yet stepped, in seconds. */
let accumulator = 0;
let lastFrame = 0;

function respawn(nextSeed: number): void {
  sim?.dispose();
  seed = nextSeed;
  sim = spawnFalling(morph, new Rng(seed));
  accumulator = 0;
  hud.seed.textContent = String(seed);
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!sim) return;

  const dt = lastFrame === 0 ? 0 : Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;

  if (!paused) {
    // Invariant 1: fixed timestep. Accumulate real time, step a whole number of times,
    // and never hand a frame delta to the solver.
    accumulator += dt;
    let budget = 0;
    while (accumulator >= TIMESTEP && budget < 600) {
      sim.step();
      accumulator -= TIMESTEP;
      budget++;
    }
  }

  const snap = sim.snapshot();
  const rect = canvas.getBoundingClientRect();
  draw(ctx!, snap, rect.width, rect.height);

  hud.time.textContent = `${snap.time.toFixed(2)} s`;
  hud.steps.textContent = String(snap.steps);
  hud.height.textContent = `${snap.torsoHeight.toFixed(3)} m`;
  hud.state.textContent = paused ? 'paused' : snap.fallen ? 'fallen' : 'upright';
  hud.state.className = snap.fallen ? 'fell' : '';
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') respawn(seed + 1);
  // Browsers disagree on whether the space bar is ' ' or 'Spacebar'; `code` does not.
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
  }
  if (e.key === '.' && paused && sim) sim.step();
});

window.addEventListener('resize', resize);

async function boot(): Promise<void> {
  await initPhysics();
  resize();
  respawn(seed);
  requestAnimationFrame(frame);
}

void boot();
