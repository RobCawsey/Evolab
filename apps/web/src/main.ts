/**
 * Slice 3 — "you can watch it".
 *
 * A fitness chart climbing beside a live replay of the current champion, with the slice-1
 * sliders still there so a hand-tuned gait and an evolved one can be compared on the same
 * screen. Evolution runs on the main thread, sliced across frames; workers are slice 4.
 */

import {
  defaultGait,
  gaitPhase,
  simpleBiped,
  Rng,
  type GaitParams,
} from '@evolab/evolution';
import { initPhysics, makeEvaluator, Sim, stepControlled, TIMESTEP } from '@evolab/sim';
import { draw } from './render/draw.ts';
import { drawChart } from './render/chart.ts';
import { createSliders, encodeGait, decodeGait } from './ui/sliders.ts';
import { activeGait, adoptChampion, createRunState, resetRun } from './run/state.ts';
import { advanceSearch, generationsPerSecond, trialsPerSecond } from './run/loop.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = el<HTMLCanvasElement>('stage');
const chart = el<HTMLCanvasElement>('chart');

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
  return ctx;
}

const sctx = context2d(stage);
const cctx = context2d(chart);

const hud = {
  time: el('v-time'), distance: el('v-distance'), phase: el('v-phase'),
  height: el('v-height'), state: el('v-state'), badge: el('stage-badge'),
};
const stat = {
  gen: el('s-gen'), progress: el('s-progress'), best: el('s-best'), mean: el('s-mean'),
  div: el('s-div'), trials: el('s-trials'), tps: el('s-tps'), gps: el('s-gps'),
  elapsed: el('s-elapsed'), chartGen: el('chart-gen'),
};
const champ = {
  dist: el('c-dist'), upright: el('c-upright'), effort: el('c-effort'),
  fell: el('c-fell'), note: el('c-note'),
};

const morph = simpleBiped();

/* ---------------- settings from the URL ---------------- */

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : fallback;
};

const gaitParam = params.get('gait');
const state = createRunState({
  seed: num('seed', 4417),
  target: num('gens', 40),
  trialSeconds: num('seconds', 4),
  population: num('pop', 24),
  manualGait: gaitParam ? decodeGait(gaitParam, defaultGait()) : defaultGait(),
  mode: params.get('mode') === 'evolved' ? 'evolved' : 'manual',
});

const evaluator = makeEvaluator(morph, { seconds: state.trialSeconds });

/* ---------------- replay ---------------- */

let sim: Sim | null = null;
let accumulator = 0;
let lastFrame = 0;
let focusX = 0;
let peakDistance = 0;
const scratch = new Map<string, number>();

/** The replay is for looking at. It never contributes to fitness. */
function respawn(): void {
  sim?.dispose();
  sim = new Sim(morph, { tilt: new Rng(state.seed).range(-0.02, 0.02) });
  accumulator = 0;
  focusX = 0;
  peakDistance = 0;
}

const panel = createSliders(el('sliders'), state.manualGait, (next) => {
  state.manualGait = next;
  if (state.mode === 'manual') respawn();
  queueUrl();
});

/* ---------------- controls ---------------- */

function setMode(mode: 'manual' | 'evolved'): void {
  if (mode === 'evolved' && !state.champion) return;
  state.mode = mode;
  el('mode-manual').classList.toggle('on', mode === 'manual');
  el('mode-evolved').classList.toggle('on', mode === 'evolved');
  el('sliders').classList.toggle('locked', mode === 'evolved');
  hud.badge.textContent = mode === 'evolved' ? 'evolved champion' : 'manual gait';
  hud.badge.classList.toggle('evolved', mode === 'evolved');
  respawn();
  queueUrl();
}

function setRunning(running: boolean): void {
  state.running = running && state.island.generation < state.target;
  el('btn-run').textContent = state.running ? 'Pause' : 'Run';
}

el('btn-run').addEventListener('click', () => setRunning(!state.running));
el('btn-reset').addEventListener('click', () => {
  resetRun(state);
  setMode('manual');
  setRunning(false);
  el('btn-adopt').setAttribute('disabled', '');
});
el('mode-manual').addEventListener('click', () => setMode('manual'));
el('mode-evolved').addEventListener('click', () => setMode('evolved'));
el('btn-adopt').addEventListener('click', () => {
  const gait = adoptChampion(state);
  if (!gait) return;
  panel.sync(gait);
  setMode('manual');
  queueUrl();
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') { e.preventDefault(); setRunning(!state.running); }
  if (e.key === 'r' || e.key === 'R') el('btn-reset').click();
  if (e.key === 'm' || e.key === 'M') setMode(state.mode === 'manual' ? 'evolved' : 'manual');
});

let urlTimer = 0;
function queueUrl(): void {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    const q = new URLSearchParams();
    q.set('seed', String(state.seed));
    q.set('gens', String(state.target));
    q.set('gait', encodeGait(state.manualGait));
    if (state.mode === 'evolved') q.set('mode', 'evolved');
    history.replaceState(null, '', `?${q.toString()}`);
  }, 250);
}

/* ---------------- frame ---------------- */

function fit(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, dpr: number): void {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fit(stage, sctx, dpr);
  fit(chart, cctx, dpr);
}

function frame(now: number): void {
  requestAnimationFrame(frame);

  // --- search -------------------------------------------------------------------
  const progress = advanceSearch(state, evaluator);
  // advanceSearch stops itself at the target; keep the button label honest about it.
  if (!state.running && el('btn-run').textContent === 'Pause') setRunning(false);
  if (progress.newChampion) {
    el('btn-adopt').removeAttribute('disabled');
    // Auto-follow the first champion, so the payoff does not need a click to be seen.
    if (state.history.length === 1) setMode('evolved');
    else if (state.mode === 'evolved') respawn();
  }

  // --- replay -------------------------------------------------------------------
  const dt = lastFrame === 0 ? 0 : Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;
  const gait: GaitParams = activeGait(state);

  if (sim) {
    accumulator += dt;
    let budget = 0;
    while (accumulator >= TIMESTEP && budget < 600) {
      stepControlled(sim, morph, gait, 1, scratch);
      accumulator -= TIMESTEP;
      budget++;
    }
    const snap = sim.snapshot();
    peakDistance = Math.max(peakDistance, snap.distance);

    // Loop the replay a moment after it settles, so the stage always has motion on it.
    if (snap.time > state.trialSeconds * 2 || (snap.fallen && snap.time > 2.5)) respawn();

    const torsoX = snap.bodies.find((b) => b.id === 'torso')?.x ?? 0;
    if (torsoX - focusX > 0.7) focusX = torsoX - 0.7;
    else if (torsoX - focusX < -0.7) focusX = torsoX + 0.7;

    const rect = stage.getBoundingClientRect();
    draw(sctx, snap, rect.width, rect.height, focusX);

    hud.time.textContent = `${snap.time.toFixed(2)} s`;
    hud.distance.textContent = `${snap.distance.toFixed(2)} m  (peak ${peakDistance.toFixed(2)})`;
    hud.phase.textContent = gaitPhase(gait, snap.time).toFixed(2);
    hud.height.textContent = `${snap.torsoHeight.toFixed(3)} m`;
    hud.state.textContent = snap.fallen ? 'fallen' : 'walking';
    hud.state.className = snap.fallen ? 'fell' : '';
  }

  // --- chart and stats ----------------------------------------------------------
  const crect = chart.getBoundingClientRect();
  drawChart(cctx, state.history, crect.width, crect.height, {
    showDiversity: true,
    targetGenerations: state.target,
  });
  paintStats();
}

function paintStats(): void {
  const last = state.history[state.history.length - 1];
  const gen = state.island.generation;
  stat.gen.textContent = `${gen} / ${state.target}`;
  stat.chartGen.textContent = `generation ${gen}`;
  stat.progress.style.width = `${Math.min(100, (gen / state.target) * 100)}%`;
  stat.best.textContent = last ? last.best.toFixed(3) : '—';
  stat.mean.textContent = last ? last.mean.toFixed(3) : '—';
  stat.div.textContent = last ? last.diversity.toFixed(3) : '—';
  stat.trials.textContent = String(state.trials);
  stat.tps.textContent = state.trials ? trialsPerSecond(state).toFixed(0) : '—';
  stat.gps.textContent = state.history.length ? generationsPerSecond(state).toFixed(1) : '—';
  stat.elapsed.textContent = `${(state.elapsedMs / 1000).toFixed(1)} s`;

  const r = state.champion && last ? last.bestResult : null;
  champ.dist.textContent = r ? `${r.distance.toFixed(2)} m` : '—';
  champ.upright.textContent = r ? `${r.uprightTime.toFixed(2)} s of ${state.trialSeconds}` : '—';
  champ.effort.textContent = r ? `${r.effort.toFixed(0)} rad` : '—';
  champ.fell.textContent = r ? (r.fell ? 'yes' : 'no') : '—';
  if (r) {
    champ.fell.className = r.fell ? 'fell' : 'ok';
    champ.note.textContent = state.mode === 'evolved'
      ? 'The stage is replaying the best genome found so far. Switch to Manual to compare.'
      : 'Switch to Evolved to watch the champion, or copy it into the sliders and poke at it.';
  }
}

/* ---------------- boot ---------------- */

async function boot(): Promise<void> {
  await initPhysics();
  resize();
  respawn();
  setMode(state.mode === 'evolved' && state.champion ? 'evolved' : 'manual');
  queueUrl();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
void boot();
