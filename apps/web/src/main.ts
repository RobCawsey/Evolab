/**
 * Slice 1 — "it walks, badly".
 *
 * A hand-tunable open-loop gait drives the biped's joint motors. Ten sliders, live, no
 * respawn needed. The exercise is to find something that walks; the discovery is that you
 * cannot, really, and that is what slice 2 is for.
 */

import { defaultGait, gaitPhase, simpleBiped, Rng, type GaitParams } from '@evolab/evolution';
import { initPhysics, Sim, stepControlled, TIMESTEP } from '@evolab/sim';
import { draw } from './render/draw.ts';
import { createSliders, encodeGait, decodeGait } from './ui/sliders.ts';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hud = {
  time: el('v-time'),
  distance: el('v-distance'),
  phase: el('v-phase'),
  height: el('v-height'),
  state: el('v-state'),
};

const morph = simpleBiped();

const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));

let seed = params.has('seed') && Number.isFinite(seedParam) ? seedParam : 4417;
let paused = params.get('paused') === '1';
let driven = params.get('mode') !== 'ragdoll';
let gait: GaitParams = params.has('gait') ? decodeGait(params.get('gait')!, defaultGait()) : defaultGait();

let sim: Sim | null = null;
let accumulator = 0;
let lastFrame = 0;
let peakDistance = 0;
const scratch = new Map<string, number>();

const panel = createSliders(el('sliders'), gait, (next) => {
  gait = next;
  peakDistance = 0;
  queueUrl();
});

/* ---------------- URL, debounced ---------------- */

let urlTimer = 0;
function queueUrl(): void {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    const q = new URLSearchParams();
    q.set('seed', String(seed));
    q.set('gait', encodeGait(gait));
    if (!driven) q.set('mode', 'ragdoll');
    history.replaceState(null, '', `?${q.toString()}`);
  }, 250);
}

/* ---------------- run control ---------------- */

function respawn(nextSeed = seed): void {
  sim?.dispose();
  seed = nextSeed;
  // A much smaller tilt than slice 0's ragdoll: enough to break perfect symmetry, not
  // enough to be the reason it falls over.
  sim = new Sim(morph, { tilt: new Rng(seed).range(-0.02, 0.02) });
  accumulator = 0;
  peakDistance = 0;
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function advance(steps: number): void {
  if (!sim) return;
  if (driven) stepControlled(sim, morph, gait, steps, scratch);
  else sim.stepMany(steps);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!sim) return;

  const dt = lastFrame === 0 ? 0 : Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;

  if (!paused) {
    // Ground rule 1: accumulate real time and step a whole number of fixed steps. The
    // budget stops a backgrounded tab trying to catch up on ten seconds of physics.
    accumulator += dt;
    let budget = 0;
    while (accumulator >= TIMESTEP && budget < 600) {
      advance(1);
      accumulator -= TIMESTEP;
      budget++;
    }
  }

  const snap = sim.snapshot();
  peakDistance = Math.max(peakDistance, snap.distance);

  const rect = canvas.getBoundingClientRect();
  draw(ctx!, snap, rect.width, rect.height);

  hud.time.textContent = `${snap.time.toFixed(2)} s`;
  hud.distance.textContent = `${snap.distance.toFixed(2)} m  (peak ${peakDistance.toFixed(2)})`;
  hud.phase.textContent = driven ? gaitPhase(gait, snap.time).toFixed(2) : '—';
  hud.height.textContent = `${snap.torsoHeight.toFixed(3)} m`;
  hud.state.textContent = paused ? 'paused' : snap.fallen ? 'fallen' : driven ? 'driven' : 'ragdoll';
  hud.state.className = snap.fallen ? 'fell' : '';
}

/* ---------------- input ---------------- */

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'r' || e.key === 'R') respawn();
  if (e.key === 'g' || e.key === 'G') {
    driven = !driven;
    respawn();
    queueUrl();
  }
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
  }
  if (e.key === '.' && paused) advance(1);
});

el('btn-reset').addEventListener('click', () => respawn());
el('btn-default').addEventListener('click', () => {
  gait = defaultGait();
  panel.sync(gait);
  respawn();
  queueUrl();
});

window.addEventListener('resize', resize);

async function boot(): Promise<void> {
  await initPhysics();
  resize();
  respawn(seed);
  queueUrl();
  requestAnimationFrame(frame);
}

void boot();
