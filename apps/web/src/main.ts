/**
 * Slice 6 — "guided first run".
 *
 * A fitness chart climbing beside a live replay of the current champion, with the slice-1
 * sliders still there so a hand-tuned gait and an evolved one can be compared on the same
 * screen. The search itself runs in Web Workers — one island each, trading migrants
 */

import {
  defaultGait,
  gaitPhase,
  simpleBiped,
  Rng,
  type GaitParams,
} from '@evolab/evolution';
import { initPhysics, Sim, stepControlled, TIMESTEP } from '@evolab/sim';
import { draw } from './render/draw.ts';
import { drawChart } from './render/chart.ts';
import { createSliders, encodeGait, decodeGait } from './ui/sliders.ts';
import { createStepper } from './ui/stepper.ts';
import { createGuided } from './ui/guided.ts';
import { presetByKey, type Preset } from './run/objectives.ts';
import {
  activeGait, adoptChampion, createRunState, offerChampion, offerFirst, sampleHistory,
  spawnPool, type AppStage,
} from './run/state.ts';
import { generationsPerSecond, parallelSpeedup, trialsPerSecond } from './run/loop.ts';

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
  elapsed: el('s-elapsed'), chartGen: el('chart-gen'), speedup: el('s-speedup'),
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
const workersParam = params.has('workers') ? Math.max(1, num('workers', 1)) : undefined;
const state = createRunState({
  ...(workersParam === undefined ? {} : { workers: workersParam }),
  seed: num('seed', 4417),
  target: num('gens', 30),
  trialSeconds: num('seconds', 4),
  population: num('pop', 24),
  manualGait: gaitParam ? decodeGait(gaitParam, defaultGait()) : defaultGait(),
  mode: params.get('mode') === 'evolved' ? 'evolved' : 'manual',
  preset: presetByKey(params.get('goal')),
  stage: (['guided', 'explorer', 'lab'] as const).includes(params.get('stage') as AppStage)
    ? (params.get('stage') as AppStage)
    : 'guided',
});

/**
 * Bring the ring up. Workers initialise in parallel — each pays about 40 ms for its own
 * Rapier instance — so this happens at start-up rather than on the first press of Run.
 */
function startPool(): void {
  el('btn-run').setAttribute('disabled', '');
  spawnPool(state, morph, {
    onReady: () => {
      el('btn-run').removeAttribute('disabled');
      paintIslands();
    },
    onGeneration: (_id, summary) => {
      offerFirst(state, summary);
      if (offerChampion(state, summary)) {
        el('btn-adopt').removeAttribute('disabled');
        if (state.history.length <= 1) setMode('evolved');
        else if (state.mode === 'evolved') respawn();
      }
    },
    onError: (id, message) => console.error(`island ${id}:`, message),
  });
}

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

const BADGE: Record<'manual' | 'evolved' | 'first', string> = {
  manual: 'manual gait',
  evolved: 'evolved champion',
  first: 'first attempt',
};

function setMode(mode: 'manual' | 'evolved' | 'first'): void {
  if (mode === 'evolved' && !state.champion) return;
  if (mode === 'first' && !state.firstChampion) return;
  state.mode = mode;
  el('mode-manual').classList.toggle('on', mode === 'manual');
  el('mode-evolved').classList.toggle('on', mode === 'evolved');
  el('sliders').classList.toggle('locked', mode !== 'manual');
  hud.badge.textContent = BADGE[mode];
  hud.badge.classList.toggle('evolved', mode === 'evolved');
  respawn();
  queueUrl();
}

/**
 * Guided / Explorer / Lab. Nothing is locked — this only decides which panels are on
 * screen, so a curious beginner reaches the full instrument in one click and an
 * experienced user never has to earn it (§7 of the design document).
 */
function setStage(next: AppStage): void {
  state.stage = next;
  document.body.dataset['stage'] = next;
  for (const s of ['guided', 'explorer', 'lab'] as const) {
    el(`stage-${s}`).classList.toggle('on', s === next);
  }
  queueUrl();
}

function setRunning(running: boolean): void {
  const pool = state.pool;
  if (!pool || !pool.ready) return;
  state.running = running && pool.generation < state.target;
  el('btn-run').textContent = state.running ? 'Pause' : 'Run';
  if (state.running) {
    state.startedAt = performance.now();
    pool.run(state.target);
  } else {
    pool.pause();
  }
}

el('btn-run').addEventListener('click', () => setRunning(!state.running));
el('btn-reset').addEventListener('click', () => {
  state.running = false;
  el('btn-run').textContent = 'Run';
  el('btn-adopt').setAttribute('disabled', '');
  startPool();
  setMode('manual');
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

for (const s of ['guided', 'explorer', 'lab'] as const) {
  el(`stage-${s}`).addEventListener('click', () => setStage(s));
}

/**
 * The stepper owns its own small island rather than borrowing one from the pool: stepping
 * needs synchronous control of a generation, and the pool's islands live in workers.
 */
const stepper = createStepper(morph, { seed: state.seed });
el('btn-stepper').addEventListener('click', () => stepper.open());

const guided = createGuided(el('guided'), {
  // Changing the goal changes what every island is scoring against, and islands take their
  // objective at construction — so a new goal is a new search, which is also what the
  // learner means by it.
  onPreset(preset: Preset): void {
    state.preset = preset;
    state.running = false;
    startPool();
    setMode('manual');
    queueUrl();
  },
  onRun(): void {
    if (!state.pool) return;
    if (state.pool.generation >= state.target) startPool();
    setRunning(!state.running);
  },
  onWatch(which): void {
    setMode(which === 'first' ? 'first' : 'evolved');
  },
  onStepper: () => stepper.open(),
  onExplorer: () => setStage('explorer'),
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (stepper.isOpen) return;
  if (e.code === 'Space') { e.preventDefault(); setRunning(!state.running); }
  if (e.key === 'r' || e.key === 'R') el('btn-reset').click();
  if (e.key === 'm' || e.key === 'M') setMode(state.mode === 'manual' ? 'evolved' : 'manual');
  if (e.key === 's' || e.key === 'S') stepper.open();
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
    q.set('stage', state.stage);
    q.set('goal', state.preset.key);
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

  // --- sample the ring ----------------------------------------------------------
  // The workers own the search now. All the frame does is read what they have reported,
  // which is why the frame budget is no longer a constraint on throughput.
  if (state.running && state.pool) {
    state.elapsedMs = performance.now() - state.startedAt;
    sampleHistory(state);
    if (state.pool.generation >= state.target) {
      state.running = false;
      state.pool.pause();
      el('btn-run').textContent = 'Run';
    }
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
  const pool = state.pool;
  const last = state.history[state.history.length - 1];
  const gen = pool && Number.isFinite(pool.generation) ? pool.generation : 0;
  stat.gen.textContent = `${gen} / ${state.target}`;
  stat.chartGen.textContent = `generation ${gen}`;
  stat.progress.style.width = `${Math.min(100, (gen / state.target) * 100)}%`;
  stat.best.textContent = last ? last.best.toFixed(3) : '—';
  stat.mean.textContent = last ? last.mean.toFixed(3) : '—';
  stat.div.textContent = last ? last.diversity.toFixed(3) : '—';
  stat.trials.textContent = String(pool?.trials ?? 0);
  stat.tps.textContent = pool?.trials ? trialsPerSecond(state).toFixed(0) : '—';
  stat.gps.textContent = state.history.length ? generationsPerSecond(state).toFixed(1) : '—';
  stat.elapsed.textContent = `${(state.elapsedMs / 1000).toFixed(1)} s`;
  stat.speedup.textContent = pool?.trials ? `${parallelSpeedup(state).toFixed(1)}×` : '—';
  paintIslands();

  const r = state.champion ? state.champion.summary.bestResult : null;
  guided.update({
    championDistance: state.champion?.summary.bestResult?.distance ?? null,
    firstDistance: state.firstChampion?.summary.bestResult?.distance ?? null,
    generation: gen,
    target: state.target,
    running: state.running,
    ready: pool?.ready ?? false,
    preset: state.preset,
    watching: state.mode === 'first' ? 'first' : 'champion',
    trials: pool?.trials ?? 0,
    outcome: r
      ? {
          fell: r.fell,
          distance: r.distance,
          uprightTime: r.uprightTime,
          trialSeconds: state.trialSeconds,
        }
      : null,
  });

  champ.dist.textContent = r ? `${r.distance.toFixed(2)} m` : '—';
  champ.upright.textContent = r ? `${r.uprightTime.toFixed(2)} s of ${state.trialSeconds}` : '—';
  champ.effort.textContent = r ? `${r.effort.toFixed(0)} rad` : '—';
  champ.fell.textContent = r ? (r.fell ? 'yes' : 'no') : '—';
  // The note has to suit the stage: in guided there are no sliders to be told about.
  if (!r) {
    champ.note.textContent = state.stage === 'guided'
      ? 'Pick a goal, then start evolving. The first robots will fall over immediately.'
      : 'Nothing evolved yet. Tune the sliders by hand first — then press Run and watch how long it takes to beat you.';
  } else {
    champ.fell.className = r.fell ? 'fell' : 'ok';
    champ.note.textContent =
      state.stage === 'guided'
        ? 'This is the best gait found so far. Step 4 lets you compare it with the first attempt.'
        : state.mode === 'evolved'
          ? 'The stage is replaying the best genome found so far. Switch to Manual to compare.'
          : 'Switch to Evolved to watch the champion, or copy it into the sliders and poke at it.';
  }
}

/**
 * One row per island: generation, best fitness, and a flag when a migrant arrival was
 * followed by a jump. Migration is meant to be observable rather than merely believed in.
 */
function paintIslands(): void {
  const pool = state.pool;
  const host = el('islands');
  if (!pool) return;
  if (host.childElementCount !== pool.islands.length) {
    host.replaceChildren(...pool.islands.map(() => {
      const row = document.createElement('div');
      row.className = 'kv island';
      row.innerHTML = '<span></span><i class="bar"></i><b></b>';
      return row;
    }));
  }
  const best = pool.best || 1;
  pool.islands.forEach((isl, i) => {
    const row = host.children[i] as HTMLElement;
    const [label, bar, value] = row.children as unknown as [HTMLElement, HTMLElement, HTMLElement];
    label.textContent = `${String(i).padStart(2, '0')}  g${isl.generation}`;
    bar.style.width = `${Math.max(2, (isl.best / best) * 100)}%`;
    value.textContent = isl.ready ? isl.best.toFixed(2) : 'init';
    row.classList.toggle('boosted', isl.boosted);
    value.className = isl.boosted ? 'am' : '';
  });
}

/* ---------------- boot ---------------- */

async function boot(): Promise<void> {
  // The main thread still needs its own Rapier instance for the replay. WASM memory is not
  // shared, so the workers each bring up their own — that is what the ready gate is for.
  await initPhysics();
  resize();
  respawn();
  el('s-workers').textContent = String(state.workers);
  setStage(state.stage);
  startPool();
  setMode('manual');
  queueUrl();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
void boot();
