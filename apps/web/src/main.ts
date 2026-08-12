/**
 * Slice 11 — the challenge track ties the instrument together.
 *
 * A fitness chart climbing beside a live replay of the current champion, with the slice-1
 * sliders still there so a hand-tuned gait and an evolved one can be compared on the same
 * screen. The search itself runs in Web Workers — one island each, trading migrants
 */

import {
  DEFAULT_SPEC,
  archiveCoverage,
  buildScorecard,
  archiveQd,
  buildBiped,
  clampSpec,
  decodeGenome,
  defaultGait,
  gaitPhase,
  Rng,
  type Archive,
  type BipedSpec,
  type GaitParams,
} from '@evolab/evolution';
import {
  evaluateGait, initPhysics, Sim, snapshotAt, stepControlled, TIMESTEP,
  type Recording, type Snapshot,
} from '@evolab/sim';
import { draw } from './render/draw.ts';
import { drawChart } from './render/chart.ts';
import { cellAt, drawArchive, type ArchiveView } from './render/archive.ts';
import { attachOrbit, createScrubber } from './render/three/controls.ts';
import { drawFootfall } from './render/gait/footfall.ts';
import { drawTraces } from './render/gait/traces.ts';
import { drawPortrait } from './render/gait/portrait.ts';
import { plotRect, xToFrame } from './render/gait/common.ts';
import type { OrbitHandle } from './render/three/controls.ts';
import type { ThreeView } from './render/three/scene.ts';
import { createSliders, encodeGait, decodeGait } from './ui/sliders.ts';
import { createStepper } from './ui/stepper.ts';
import { createToolbar } from './ui/toolbar.ts';
import { attachHelpButtons, createHelp } from './ui/help/panel.ts';
import { LISTED_SHORTCUTS, shortcutFor } from './ui/keymap.ts';
import { createGuided } from './ui/guided.ts';
import { createEditor, decodeSpec, encodeSpec } from './ui/editor.ts';
import { presetByKey, type Preset } from './run/objectives.ts';
import { createTrack } from './challenges/track.ts';
import { evaluateCheck } from './challenges/check.ts';
import { challengeById } from './challenges/data.ts';
import {
  completeCard, completed, dismissNote, loadProgress, saveProgress,
} from './challenges/progress.ts';
import type { Challenge, Outcome } from './challenges/types.ts';
import {
  activeGait, adoptChampion, createRunState, offerChampion, offerFirst, sampleHistory,
  spawnPool, type AppStage,
} from './run/state.ts';
import { generationsPerSecond, parallelSpeedup, trialsPerSecond } from './run/loop.ts';
import { api, reportFailure, reported } from './net/api.ts';
import { buildCommunity, overlapOf, type Community } from './net/community.ts';
import { createScorecardPanel } from './ui/scorecard.ts';
import { runScorecard } from './workers/scorecard.ts';
import { createFailureIndicator, createRunsPanel } from './net/panel.ts';
import { defaultTitle, runPayload } from './net/serialise.ts';
import type { RunSummary } from './net/types.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = el<HTMLCanvasElement>('stage');
const chart = el<HTMLCanvasElement>('chart');
const archiveCanvas = el<HTMLCanvasElement>('archive');
const stage3d = el<HTMLCanvasElement>('stage3d');

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
  return ctx;
}

const sctx = context2d(stage);
const cctx = context2d(chart);
const actx = context2d(archiveCanvas);

const hud = {
  time: el('v-time'), distance: el('v-distance'), phase: el('v-phase'),
  height: el('v-height'), state: el('v-state'), badge: el('stage-badge'),
};
const stat = {
  gen: el('s-gen'), progress: el('s-progress'), best: el('s-best'), mean: el('s-mean'),
  div: el('s-div'), trials: el('s-trials'), tps: el('s-tps'), gps: el('s-gps'),
  elapsed: el('s-elapsed'), chartGen: el('chart-gen'), speedup: el('s-speedup'),
};
const arch = {
  cov: el('arch-cov'), pct: el('arch-pct'), best: el('arch-best'),
  qd: el('arch-qd'), rate: el('arch-rate'), note: el('arch-note'),
  mine: el('arch-mine'), all: el('arch-all'),
};
const champ = {
  dist: el('c-dist'), upright: el('c-upright'), effort: el('c-effort'),
  fell: el('c-fell'), note: el('c-note'),
};

/**
 * The body is mutable from slice 7 on. Changing it rebuilds the replay immediately — you
 * watch the champion gait on the new legs as you drag — but leaves the pool alone until the
 * next run, because every fitness in it was measured against the old body.
 */
let spec: BipedSpec = DEFAULT_SPEC;
let morph = buildBiped(spec);
let poolStale = false;

/* ---------------- settings from the URL ---------------- */

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : fallback;
};

const specParam = params.get('body');
if (specParam) {
  spec = clampSpec(decodeSpec(specParam, DEFAULT_SPEC));
  morph = buildBiped(spec);
}

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
  view: params.get('view') === '3d' ? '3d' : '2d',
  challenge: params.get('card'),
});

/**
 * Bring the ring up. Workers initialise in parallel — each pays about 40 ms for its own
 * Rapier instance — so this happens at start-up rather than on the first press of Run.
 */
function startPool(): void {
  poolStale = false;
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
        paintRuns();
        if (state.history.length <= 1) setMode('evolved');
        else if (state.mode === 'evolved') respawn();
      }
    },
    onError: (id, message) => console.error(`island ${id}:`, message),
  });
}

/* ---------------- toolbar ---------------- */

/**
 * **Listed in the order they appear on screen**, because that is the order they are put back
 * in when the bar is repacked — listing them by priority instead silently rearranged the
 * whole toolbar on the first resize.
 *
 * `priority` is the separate question of what is given up first, lowest going first: the two
 * long-labelled buttons before anything with a short label, and Run last, because a toolbar
 * without it is not a toolbar.
 */
const toolbar = createToolbar(
  document.querySelector('header')!,
  document.querySelector('header .spacer')!,
  [
    { id: 'stages', priority: 7 },
    { id: 'btn-run', priority: 10 },
    { id: 'btn-reset', priority: 3 },
    { id: 'modes', priority: 4 },
    { id: 'btn-adopt', priority: 1 },
    { id: 'views', priority: 5 },
    // The drawer toggles rank just under Run: below 1000px they are the only way to reach
    // the side panels at all, so collapsing them into a menu to save room would hide the
    // controls behind the control that reveals them.
    { id: 'btn-panel-left', priority: 8 },
    { id: 'btn-panel-right', priority: 9 },
    { id: 'btn-challenges', priority: 6 },
    { id: 'btn-stepper', priority: 2 },
    // Help gives way earliest of all: it is reachable from the ⋯ menu and from `?`, so it is
    // the one control that loses nothing by being collapsed.
    { id: 'btn-help', priority: 0 },
  ],
);

/* ---------------- side panels as drawers, below 1000px ---------------- */

/**
 * §10's chassis change, in the ten lines of state it actually needs.
 *
 * The panels are the same elements in both chassis — only their positioning changes, in CSS.
 * This just decides which is open, and closes the other, because two overlay drawers at once
 * on a 390px screen leaves nothing to look at.
 */
const drawers = [
  { button: el('btn-panel-left'), panel: document.querySelector<HTMLElement>('aside.left')! },
  { button: el('btn-panel-right'), panel: document.querySelector<HTMLElement>('aside.right')! },
];

function setDrawer(open: HTMLElement | null): void {
  for (const d of drawers) {
    const isOpen = d.panel === open;
    d.panel.classList.toggle('open', isOpen);
    d.button.classList.toggle('on', isOpen);
  }
  el('scrim').hidden = open === null;
}

for (const d of drawers) {
  d.button.addEventListener('click', () => {
    setDrawer(d.panel.classList.contains('open') ? null : d.panel);
  });
}
el('scrim').addEventListener('click', () => setDrawer(null));

/* ---------------- replay ---------------- */

let sim: Sim | null = null;
let accumulator = 0;
let lastFrame = 0;
let focusX = 0;
let peakDistance = 0;
const scratch = new Map<string, number>();

/**
 * The replay has two sources and the mode picks between them.
 *
 * **Manual gaits play live**, because dragging a slider and watching the stride change on
 * the next step is the entire feedback loop the sliders exist for; restarting a recorded
 * trial on every input event would destroy it.
 *
 * **Champions play from a recording**, because a champion changes rarely and a recording is
 * the only thing you can scrub. Both paths hand the renderers a `Snapshot`, so neither the
 * 2D nor the 3D view knows which one it is drawing.
 */
let recording: Recording | null = null;
let playFrame = 0;
let playing = true;

const scrubber = createScrubber(el('scrub'), {
  onSeek: (frame) => {
    playFrame = frame;
  },
  onPlayToggle: (next) => {
    playing = next;
  },
});

/** The replay is for looking at. It never contributes to fitness. */
function respawn(): void {
  sim?.dispose();
  sim = null;
  recording = null;
  accumulator = 0;
  focusX = 0;
  peakDistance = 0;
  playFrame = 0;

  if (state.mode === 'manual') {
    sim = new Sim(morph, { tilt: new Rng(state.seed).range(-0.02, 0.02) });
  } else {
    // Exactly the scored trial length — **not** twice it, which is what slice 9 recorded.
    //
    // Slice 10 puts a duty factor on the footfall diagram, and the behaviour map puts one on
    // the cell beside it. Recording eight seconds of a four-second trial made those two
    // numbers disagree (0.83 against 0.80) with nothing on screen to explain why. Matching
    // the window is worth more than the extra four seconds of walking: the scrubber now
    // shows the run that produced the numbers next to it, rather than a longer run that
    // resembles it.
    const taped = evaluateGait(morph, activeGait(state), {
      seed: state.seed,
      seconds: state.trialSeconds,
      record: true,
    });
    recording = taped.recording;
    scrubber.attach(recording.frames, recording.hz);
  }
  el('scrub').classList.toggle('on', recording !== null);
  el('gait').classList.toggle('on', recording !== null);
  gaitPainted = -1;
}

/** The snapshot both renderers draw this frame, or null if there is nothing to draw yet. */
function replayFrame(dt: number, gait: GaitParams): Snapshot | null {
  if (recording) {
    if (playing) {
      playFrame += dt * recording.hz;
      if (playFrame > recording.frames - 1) playFrame = 0;
    }
    scrubber.show(Math.round(playFrame), playing);
    return snapshotAt(recording, playFrame);
  }

  if (!sim) return null;
  accumulator += dt;
  let budget = 0;
  while (accumulator >= TIMESTEP && budget < 600) {
    stepControlled(sim, morph, gait, 1, scratch);
    accumulator -= TIMESTEP;
    budget++;
  }
  const snap = sim.snapshot();
  // Loop the replay a moment after it settles, so the stage always has motion on it.
  if (snap.time > state.trialSeconds * 2 || (snap.fallen && snap.time > 2.5)) respawn();
  return snap;
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

  // The challenge track cannot function in the guided stage — Run, Reset, the behaviour map
  // and the gait strip are all hidden there — so going to Guided closes it and gives the
  // guided flow its column back. That is not a lock: reopening the track puts you back in
  // Explorer, which is the stage it needs.
  const track = el('challenges');
  if (next === 'guided' && !track.hidden) {
    track.hidden = true;
    el('btn-challenges').classList.remove('on');
  }
  el('guided').hidden = next !== 'guided' || !track.hidden;

  // Stage changes show and hide `.explorer-only` controls without changing the header's
  // own size, so no ResizeObserver fires and the bar has to be told to repack.
  toolbar.refresh();
  queueUrl();
}

function setRunning(running: boolean): void {
  if (running && poolStale) {
    // The body changed since the last run. Scores from the old one are meaningless now.
    stepper.retarget(morph);
    startPool();
    return;
  }
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
el('view-2d').addEventListener('click', () => setView('2d'));
el('view-3d').addEventListener('click', () => setView('3d'));
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
/**
 * Operators watched in the stepper this session.
 *
 * Not persisted: the point of cards 2 and 3 is that you *saw* the thing happen, and a count
 * restored from storage would assert that about someone who had not.
 */
const stepped = { select: 0, crossover: 0, mutate: 0 };

const stepper = createStepper(morph, {
  seed: state.seed,
  onStage: (kind) => {
    if (kind !== 'select' && kind !== 'crossover' && kind !== 'mutate') return;
    stepped[kind]++;
    // Checked immediately rather than at the end of a run. A stepper card has no run to end
    // — that was the bug: card 2 asked you to watch a tournament and then waited for thirty
    // generations of a pool the stepper does not touch.
    settleChallenge();
  },
});
el('btn-stepper').addEventListener('click', () => stepper.open());

const editor = createEditor(el('editor'), {
  onChange(next) {
    spec = next;
    morph = buildBiped(spec);
    // The replay is cheap to rebuild, so the champion appears on the new body as you drag.
    // The pool is not: every score in it was measured on the old body, so it is marked
    // stale and rebuilt on the next run rather than thrown away mid-drag.
    poolStale = true;
    respawn();
    editor.update(spec, state.champion !== null);
    queueUrl();
  },
  onReset() {
    applySpec(DEFAULT_SPEC);
  },
  onRetest() {
    stepper.retarget(morph);
    setMode('evolved');
  },
});

/**
 * Replace the body wholesale — the reset button, and slice 13's "use the body it was evolved
 * on". Distinct from the editor's `onChange`, which fires per slider tick and deliberately does
 * not retarget the stepper mid-drag.
 */
function applySpec(next: BipedSpec): void {
  spec = next;
  morph = buildBiped(spec);
  // Every fitness in the pool was measured on the old body, so it is marked stale and rebuilt
  // on the next run rather than thrown away here.
  poolStale = true;
  respawn();
  stepper.retarget(morph);
  editor.update(spec, state.champion !== null);
  queueUrl();
}

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

const help = createHelp(document.body);
el('btn-help').addEventListener('click', () => help.open());

// The toolbar's keyboard hint, generated rather than typed. It was a hardcoded string listing
// five shortcuts, which made three descriptions of the keymap in the codebase; there is one now.
el('hint').textContent = LISTED_SHORTCUTS.map((s) => s.label).join(' · ');
el('hint').title = LISTED_SHORTCUTS.map((s) => `${s.label} — ${s.does}`).join('\n');

/**
 * Dispatch from `SHORTCUTS` rather than from a ladder of `if`s.
 *
 * The shortcuts are data because **help lists them**, and a list typed out by hand beside a
 * handler is a second description free to rot. One array now: the handler reads it and so does
 * the help section, so a key cannot be documented without existing.
 */
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;

  const shortcut = shortcutFor(e);
  if (!shortcut) return;

  // Escape closes whatever is on top, and is the only key that works while an overlay is open.
  if (shortcut.key === 'Escape') {
    if (help.isOpen) help.close();
    else setDrawer(null);
    return;
  }
  if (help.isOpen || stepper.isOpen) return;

  switch (shortcut.key) {
    case 'Space': e.preventDefault(); setRunning(!state.running); return;
    case 'r': el('btn-reset').click(); return;
    case 'm': setMode(state.mode === 'manual' ? 'evolved' : 'manual'); return;
    case '2': setView('2d'); return;
    case '3': setView('3d'); return;
    case 's': stepper.open(); return;
    case '?': help.open(); return;
  }
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
    if (state.view === '3d') q.set('view', '3d');
    if (state.challenge) q.set('card', state.challenge);
    q.set('goal', state.preset.key);
    if (encodeSpec(spec) !== encodeSpec(DEFAULT_SPEC)) q.set('body', encodeSpec(spec));
    history.replaceState(null, '', `?${q.toString()}`);
  }, 250);
}

/* ---------------- gait analysis ---------------- */

/**
 * Three read-outs of *how* the champion walks, under the stage.
 *
 * **They call nothing.** Every number comes from the `Recording` the replay is already
 * playing, so opening them costs no simulation — which is the whole reason slice 9's
 * recorder captured joint angles and foot contacts it had no use for at the time.
 *
 * They share `playFrame` with the scrubber rather than keeping their own copy. Two time
 * sources that can drift apart would be worse than one panel fewer.
 */
const gaitPanels = {
  footfall: { canvas: el<HTMLCanvasElement>('g-footfall'), ctx: context2d(el<HTMLCanvasElement>('g-footfall')) },
  traces: { canvas: el<HTMLCanvasElement>('g-traces'), ctx: context2d(el<HTMLCanvasElement>('g-traces')) },
  portrait: { canvas: el<HTMLCanvasElement>('g-portrait'), ctx: context2d(el<HTMLCanvasElement>('g-portrait')) },
};

/** Frame last drawn, so a paused replay is not redrawn sixty times a second for nothing. */
let gaitPainted = -1;

function paintGait(): void {
  if (!recording) return;
  const frame = Math.round(playFrame);
  if (frame === gaitPainted) return;
  gaitPainted = frame;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const [name, panel] of Object.entries(gaitPanels)) {
    const rect = panel.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // Sized here rather than only in `resize()`, because the strip is display:none until a
    // recording exists — at boot it measures zero, and a canvas fitted to zero stays a 0×0
    // backing store that silently draws nothing however correct the rest of this is.
    if (panel.canvas.width !== Math.round(rect.width * dpr)) fit(panel.canvas, panel.ctx, dpr);

    if (name === 'footfall') drawFootfall(panel.ctx, recording, frame, rect.width, rect.height);
    else if (name === 'traces') drawTraces(panel.ctx, recording, frame, rect.width, rect.height);
    else drawPortrait(panel.ctx, recording, frame, rect.width, rect.height);
  }
}

/**
 * Click either time panel to seek there.
 *
 * `xToFrame` is the exact inverse of the mapping the panels draw with, so the frame under
 * the pointer is the frame that gets drawn — no rounding drift between clicking and seeing.
 */
for (const panel of [gaitPanels.footfall, gaitPanels.traces]) {
  panel.canvas.addEventListener('click', (e) => {
    if (!recording) return;
    const rect = panel.canvas.getBoundingClientRect();
    playFrame = xToFrame(plotRect(rect.width, rect.height), recording, e.clientX - rect.left);
    // Seeking implies pausing, exactly as dragging the scrubber does.
    playing = false;
    scrubber.show(Math.round(playFrame), false);
    gaitPainted = -1;
  });
}

/* ---------------- the 3D view ---------------- */

/**
 * Three.js arrives here and nowhere else, behind a dynamic `import()`.
 *
 * It is about 600 kB and the guided flow never opens this view, so it must not be in the
 * first paint. Vite splits it into its own chunk purely because this is the only reference
 * to it and the reference is asynchronous.
 *
 * The 3D view **does not get its own clock**. It renders whatever snapshot the replay
 * produced this frame — the same one the 2D canvas would have drawn. Invariant 1 does not
 * bend because something has an orbit camera now.
 */
let threeView: ThreeView | null = null;
let orbitHandle: OrbitHandle | null = null;
let threeLoading = false;

async function ensureThree(): Promise<void> {
  if (threeView || threeLoading) return;
  threeLoading = true;
  try {
    // Only `scene.ts` is dynamic — it is the one that pulls in Three. `controls.ts` imports
    // nothing from Three but a type, so it is loaded statically with the scrubber; importing
    // it both ways would have kept it out of its own chunk and bought nothing.
    const { createThreeView } = await import('./render/three/scene.ts');
    threeView = createThreeView(stage3d);
    orbitHandle = attachOrbit(stage3d, threeView.orbit, () => {
      /* The next frame picks the new camera up; nothing to do here. */
    });
    // Double-click to get back to the default three-quarter view. Easy to lose the robot
    // entirely by dragging past the poles, and hunting for it is not a puzzle worth setting.
    stage3d.addEventListener('dblclick', () => threeView?.resetCamera());
    const rect = stage3d.getBoundingClientRect();
    threeView.resize(rect.width, rect.height);
  } catch (err) {
    console.error('the 3D view failed to load:', err);
    setView('2d');
  } finally {
    threeLoading = false;
  }
}

function setView(next: '2d' | '3d'): void {
  state.view = next;
  document.body.dataset['view'] = next;
  el('view-2d').classList.toggle('on', next === '2d');
  el('view-3d').classList.toggle('on', next === '3d');
  if (next === '3d') void ensureThree();
  queueUrl();
}

/* ---------------- challenge track ---------------- */

/**
 * §7's concept ladder, wired to the instrument the last ten slices built.
 *
 * The track configures a run and reads its outcome. **It never simulates** — same rule as the
 * gait panels, same reason — and it never touches the body, because a card that changed the
 * morphology would quietly make its own run incomparable with every other number on screen.
 */
let progress = loadProgress();
let runFinished = false;

/**
 * The numbers a card can test against or quote back.
 *
 * Built from state rather than scraped from the DOM: a check that read the panels would break
 * the first time one moved, and would silently start passing or failing for the wrong reason.
 */
function currentOutcome(): Outcome {
  const pool = state.pool;
  const result = state.champion?.summary.bestResult ?? null;
  const archive = pool?.archive ?? null;
  const last = state.history[state.history.length - 1];
  return {
    championDistance: result?.distance ?? 0,
    championFitness: state.champion?.fitness ?? 0,
    championUpright: result?.uprightTime ?? 0,
    championEffort: result?.effort ?? 0,
    championStride: result?.strideLength ?? 0,
    championDuty: result?.dutyFactor ?? 0,
    championFell: result?.fell ? 1 : 0,
    firstDistance: state.firstChampion?.summary.bestResult?.distance ?? 0,
    firstFitness: state.firstChampion?.fitness ?? 0,
    generations: pool && Number.isFinite(pool.generation) ? pool.generation : 0,
    diversity: last?.diversity ?? 0,
    // Counted from the chart's own series, so the number quoted in a card is the number the
    // learner can see. Elitism makes this exactly zero; without it, it is the lesson.
    bestDips: state.history.reduce(
      (n, point, i) => (i > 0 && point.best < state.history[i - 1]!.best - 1e-9 ? n + 1 : n),
      0,
    ),
    coverage: archive ? archive.filled / archive.cells.length : 0,
    archiveCells: archive?.filled ?? 0,
    trialSeconds: state.trialSeconds,
    population: state.population,
    stepperSelections: stepped.select,
    stepperCrossovers: stepped.crossover,
    stepperMutations: stepped.mutate,
  };
}

const track = createTrack(el('challenges'), {
  onOpen: (challenge) => openChallenge(challenge),
  onDismissNote: (conceptId) => {
    progress = dismissNote(progress, conceptId);
    saveProgress(progress);
    paintTrack();
  },
});

function paintTrack(): void {
  track.update(progress, state.challenge, runFinished ? currentOutcome() : null, runFinished);
}

/**
 * Apply a card's setup and start its run.
 *
 * Deliberately restarts the pool. A card that changes the objective or the GA knobs cannot
 * reuse a population scored under the previous ones — every fitness in it would be measured
 * against a different question.
 */
function openChallenge(challenge: Challenge): void {
  const setup = challenge.setup;
  state.challenge = challenge.id;
  runFinished = false;

  if (setup.stage) setStage(setup.stage);
  if (setup.goal) state.preset = presetByKey(setup.goal);
  if (setup.gens !== undefined) state.target = setup.gens;
  if (setup.seed !== undefined) state.seed = setup.seed;
  state.gaOverrides = setup.config ?? {};

  stepper.retarget(morph);
  startPool();
  setMode('manual');

  // The focus is a hint about where to look, not a mode. Everything stays reachable.
  //
  // Closing the stepper is not optional: it is a full-screen overlay, so a card opened after
  // one of the stepper cards would otherwise leave it covering the stage — and the Run button
  // the new card asks for is underneath it.
  if (setup.focus === 'stepper') stepper.open();
  else if (stepper.isOpen) stepper.close();
  if (setup.focus === '3d') setView('3d');

  paintTrack();
  queueUrl();
}

/**
 * Check the open card when a run ends, and record what it taught.
 *
 * Progress is **per concept, not per card** — the panel answers "what do I understand now".
 * Two cards teaching `fitness-design` mark one concept between them.
 */
/**
 * A run reached its target. The afterword is due **whether or not the card was completed** —
 * the `otherwise` branches are where the teaching lives, and a learner whose robot fell needs
 * to be told why more than one whose robot walked.
 */
function finishRun(): void {
  runFinished = true;
  settleChallenge();
}

/**
 * Mark the open card complete if its check now holds. Cheap and idempotent, so it can be
 * called from anywhere something relevant might have changed.
 *
 * Progress is per concept, not per card — two cards teaching `fitness-design` mark one
 * concept between them.
 */
function settleChallenge(): void {
  const challenge = challengeById(state.challenge);
  if (challenge && !completed(progress, challenge.id)
      && evaluateCheck(challenge.success, currentOutcome())) {
    progress = completeCard(progress, challenge.id, challenge.teaches);
    saveProgress(progress);
    // A stepper card has no run to end, so completing it *is* its outcome and that is when
    // its afterword becomes due.
    runFinished = true;
  }
  paintTrack();
}

el('btn-challenges').addEventListener('click', () => {
  const panel = el('challenges');
  panel.hidden = !panel.hidden;
  el('btn-challenges').classList.toggle('on', !panel.hidden);
  // The guided flow and the track both want the left column; showing both is a mess.
  el('guided').hidden = !panel.hidden ? true : state.stage !== 'guided';

  if (!panel.hidden) {
    // The track needs the Explorer toolbar to be usable at all — Run, Reset, the behaviour
    // map and the gait strip are all `.explorer-only`. Opening it from the guided stage
    // otherwise produces a panel full of tasks and nothing to press. Cards cannot ask for
    // the guided stage (see ChallengeSetup.stage); this is the same wall reached by hand.
    if (state.stage === 'guided') setStage('explorer');
    paintTrack();
  }
});

/* ---------------- the task suite — slice 14 ---------------- */

/**
 * Six tasks, five seeds each, on ground the gait was never evolved on.
 *
 * **On demand and never automatic.** Slice 10 forbade its panels from re-running the
 * simulation, because a panel that simulates makes looking at a gait cost as much as evolving
 * one. This one exists to run trials, so the rule that replaces it is the button: a scorecard
 * happens because somebody asked for it.
 *
 * It runs in a worker of its own — see `workers/scorecard.ts` for why that is a second instance
 * of the island worker rather than a second worker file.
 */
let scoring = false;

const scorePanel = createScorecardPanel(el('scorecard'), () => void runSuiteNow());
scorePanel.enable(true);

/** The gait on screen: the champion when there is one, otherwise what the sliders say. */
function gaitUnderTest(): GaitParams {
  return state.champion ? state.champion.params : state.manualGait;
}

/**
 * A cheap number that changes whenever the thing under test does.
 *
 * A scorecard describes one gait on one body, and both are editable while it is on screen —
 * drag a slider and the card beside it becomes a claim about a robot that no longer exists.
 * Summing the eleven genes and the body's own numbers is enough to notice, and costs nothing
 * to do once a frame.
 */
function testSignature(): number {
  const g = gaitUnderTest();
  return g.frequency + g.balanceGain
    + g.hip.amplitude + g.hip.phase + g.hip.centre
    + g.knee.amplitude + g.knee.phase + g.knee.centre
    + g.ankle.amplitude + g.ankle.phase + g.ankle.centre
    + spec.torso.length + spec.torso.width
    + spec.thigh.length + spec.shank.length
    + spec.foot.length + spec.foot.height + spec.foot.ankleOffset
    + spec.density;
}

/** The signature the card on screen was computed for, or null when there is no card. */
let scoredSignature: number | null = null;

/** Called once a frame. Drops a card that has stopped describing what is on screen. */
function expireScorecard(): void {
  if (scoredSignature === null || scoring) return;
  if (Math.abs(testSignature() - scoredSignature) < 1e-9) return;
  scoredSignature = null;
  scorePanel.show(null, 0);
  scorePanel.note('The gait changed. Test it again to see what this one is worth.');
}

async function runSuiteNow(): Promise<void> {
  if (scoring) return;
  scoring = true;
  scorePanel.busy(true);
  try {
    const signature = testSignature();
    const run = await runScorecard(morph, gaitUnderTest());
    scoredSignature = signature;
    scorePanel.show(buildScorecard(run.results), run.ms);
  } catch (err) {
    // Same contract as `api.ts`: a failure is something the panel says, not something that
    // reaches the console or stops anything else working.
    scorePanel.show(null, 0);
    scorePanel.note(`Could not run the suite. ${String(err instanceof Error ? err.message : err)}`);
  } finally {
    scoring = false;
    scorePanel.busy(false);
  }
}

/* ---------------- the server, when there is one ---------------- */

/**
 * Slice 12's browser half. **Nothing here is on a critical path.**
 *
 * Evolving, replaying, scrubbing and the challenge track never wait for a response, no call
 * throws, and with no server running the panel says so once and the app behaves exactly as it
 * did for eleven slices. `reported()` records every failure for the Fig 9.9 indicator and
 * hands the result straight back, so call sites stay one line.
 */
createFailureIndicator(document.querySelector('header')!);

let savedRuns: RunSummary[] | null = null;
let saving = false;

const runsPanel = createRunsPanel(el('runs'), {
  onSave: () => void saveCurrentRun(),
  onOpen: (id) => void openSavedRun(id),
  onShare: (id) => void shareRun(id),
});

function paintRuns(): void {
  runsPanel.show(savedRuns, saving, state.champion !== null);
}

/** Fire-and-report. The list is a nicety; failing to fetch it is not worth a word on screen. */
async function refreshRuns(): Promise<void> {
  const result = await api.listRuns();
  savedRuns = result.ok ? result.data.slice() : null;
  if (!result.ok) reportFailure(result.error);
  paintRuns();
}

async function saveCurrentRun(): Promise<void> {
  const champion = state.champion;
  const result0 = champion?.summary.bestResult;
  if (!champion || !result0 || saving) return;

  saving = true;
  paintRuns();

  const body = runPayload({
    title: defaultTitle(state.preset.name, result0.distance),
    seed: state.seed,
    generations: state.pool && Number.isFinite(state.pool.generation) ? state.pool.generation : 0,
    population: state.population,
    trialSeconds: state.trialSeconds,
    workers: state.workers,
    goalKey: state.preset.key,
    objective: state.preset.objective,
    bodySpec: encodeSpec(spec),
    championGenome: encodeGait(champion.params),
    championFitness: champion.fitness,
    champion: result0,
    archive: state.pool?.archive ?? null,
    history: state.history,
  });

  const saved = reported(await api.saveRun(body));
  saving = false;

  if (saved.ok) {
    runsPanel.note('Saved. It will be here next time, on this server.');
    await refreshRuns();
  } else {
    // The run is still in the browser, which is the thing worth saying — the indicator
    // carries the detail for anyone who wants it.
    runsPanel.note('Could not save that run. It is still here — try again later.');
    paintRuns();
  }
}

/**
 * Load a stored run back onto the stage.
 *
 * Restores the body, the champion gait and the chart — the three things that make a run
 * recognisable. The behaviour archive is **not** restored into the pool: the pool's archive
 * is an observation of a live search, and filling it from a file would make coverage a claim
 * about a search that is not running.
 */
async function openSavedRun(id: string): Promise<void> {
  const result = reported(await api.getRun(id));
  if (!result.ok) {
    runsPanel.note('Could not open that run.');
    return;
  }
  const run = result.data;

  spec = clampSpec(decodeSpec(run.bodySpec, DEFAULT_SPEC));
  morph = buildBiped(spec);
  poolStale = true;
  stepper.retarget(morph);

  state.seed = run.seed;
  state.trialSeconds = run.trialSeconds;
  state.manualGait = decodeGait(run.championGenome, defaultGait());
  state.history = run.history.map((p) => ({
    generation: p.generation, best: p.best, mean: p.mean, worst: p.mean, diversity: p.diversity,
  }));

  panel.sync(state.manualGait);
  editor.update(spec, state.champion !== null);
  setMode('manual');
  runsPanel.note(`Opened "${run.title}". The gait is in the sliders; press Run to evolve from here.`);
  queueUrl();
}

/**
 * Publish: one action, two effects — a read-only link, and this run's elites folded into the
 * community archive (§5's endpoint table, slice 13).
 *
 * The number reported back is **ownership, not a delta**: how many shared cells this run holds
 * now. Publishing twice returns the same token and therefore has to report the same
 * contribution, and a delta cannot — the second call is a tie against itself, ties lose, and
 * the honest delta is zero.
 */
async function shareRun(id: string): Promise<void> {
  const result = reported(await api.publishRun(id));
  if (!result.ok) {
    runsPanel.note('Could not make a link for that run.');
    return;
  }
  const link = `${location.origin}/?shared=${result.data.token}`;
  void navigator.clipboard?.writeText(link).catch(() => {});

  const { owned, total } = result.data;
  runsPanel.note(
    `Read-only link copied. This run holds ${owned} of the ${total} cells in the shared ` +
    `behaviour map — switch the map to Everyone to see where.`,
  );
  // The shared map just changed, so anything cached is now wrong.
  community = null;
  if (archiveScope === 'all') void loadCommunity();
  await refreshRuns();
}

/**
 * `?shared=<token>` — the read-only view §10 asks for and §5 can actually deliver.
 *
 * A finished run, replayed, with no account and no history. Not live: §5 deleted SignalR
 * along with the cloud islands, so a phone cannot subscribe to a desktop session. The slice
 * 12 notes settle that in favour of §5 and mark §10 for amendment.
 */
async function openSharedRun(token: string): Promise<void> {
  const result = reported(await api.getShared(token));
  if (!result.ok) {
    runsPanel.note('That link is not valid any more.');
    return;
  }
  const run = result.data;
  spec = clampSpec(decodeSpec(run.bodySpec, DEFAULT_SPEC));
  morph = buildBiped(spec);
  state.manualGait = decodeGait(run.championGenome, defaultGait());
  state.history = run.history.map((p) => ({
    generation: p.generation, best: p.best, mean: p.mean, worst: p.mean, diversity: p.diversity,
  }));
  panel.sync(state.manualGait);
  setStage('explorer');
  setMode('manual');
  runsPanel.note(`Watching "${run.title}" — ${run.championDistance.toFixed(1)} m, shared read-only.`);
}

/* ---------------- frame ---------------- */

function fit(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, dpr: number): void {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Re-fit a canvas whose CSS box has changed size without a window resize.
 *
 * `resize()` only runs on `window.resize`, which misses every layout change the app makes to
 * itself — and slice 10 added a big one: the gait strip appears and disappears with the
 * recording, moving the stage between 822 and 1014 pixels tall. The backing store kept its
 * old size, so the browser stretched it into the new box and the parts the shorter draw no
 * longer covered kept their previous pixels. On screen that is a ghost strip of ground and
 * half a leg below the real robot.
 *
 * Checked per frame because it is two integer comparisons; re-fitting is what costs, and that
 * only happens when the size actually moved.
 */
function refit(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width === w && canvas.height === h) return false;
  fit(canvas, ctx, dpr);
  return true;
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fit(stage, sctx, dpr);
  fit(chart, cctx, dpr);
  fit(archiveCanvas, actx, dpr);
  archivePainted = -1;
  // Three owns its own drawing buffer, so it resizes itself rather than going through fit().
  const r3 = stage3d.getBoundingClientRect();
  threeView?.resize(r3.width, r3.height);
  for (const panel of Object.values(gaitPanels)) fit(panel.canvas, panel.ctx, dpr);
  gaitPainted = -1;
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
      finishRun();
    }
  }

  // --- replay -------------------------------------------------------------------
  const dt = lastFrame === 0 ? 0 : Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;
  const gait: GaitParams = activeGait(state);

  const snap = replayFrame(dt, gait);
  if (snap) {
    peakDistance = Math.max(peakDistance, snap.distance);

    const torsoX = snap.bodies.find((b) => b.id === 'torso')?.x ?? 0;
    if (torsoX - focusX > 0.7) focusX = torsoX - 0.7;
    else if (torsoX - focusX < -0.7) focusX = torsoX + 0.7;

    // One snapshot, whichever renderer is on. Drawing the hidden one as well would double
    // the cost for nothing, and letting them fall out of step is the bug the shared
    // `Snapshot` exists to prevent.
    if (state.view === '3d' && threeView) {
      const r3 = stage3d.getBoundingClientRect();
      threeView.resize(r3.width, r3.height);
      threeView.render(snap);
    } else {
      refit(stage, sctx);
      const rect = stage.getBoundingClientRect();
      draw(sctx, snap, rect.width, rect.height, focusX);
    }

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
  paintArchive();
  paintGait();
}

/* ---------------- behaviour map ---------------- */

let archiveView: ArchiveView | null = null;
/** Revision last drawn. The map only changes when a cell does, which is not every frame. */
let archivePainted = -1;
let archiveHover: number | null = null;

/* ---------------- Mine / Everyone — slice 13 ---------------- */

/**
 * Which map the panel is showing. `mine` is this session's search; `all` is the shared grid
 * every published run has contributed to.
 *
 * The toggle swaps which `Archive` the renderer is handed and nothing else. A second
 * visualisation would teach that these are two different kinds of thing, and they are not — one
 * is a merge of many of the other.
 */
let archiveScope: 'mine' | 'all' = 'mine';
let community: Community | null = null;
let communityLoading = false;

/** The default copy, captured before anything overwrites it. */
const archNoteMine = arch.note.innerHTML;

/**
 * True while the note is saying something about a cell that was clicked.
 *
 * The shared map's caption counts your outlined cells and therefore refreshes as the search
 * fills them in — which would otherwise wipe "this gait was evolved on a different body" a
 * fraction of a second after it appeared.
 */
let archiveMessageShown = false;

function setArchNote(html: string): void {
  arch.note.innerHTML = html;
  archiveMessageShown = false;
}

/**
 * A message about a specific cell, built from nodes rather than markup.
 *
 * The run title is somebody else's text. It goes in as a text node and never near a parser —
 * the same rule the saved-runs list already follows.
 */
function setArchMessage(text: string, action?: { label: string; run(): void }): void {
  arch.note.replaceChildren(document.createTextNode(text));
  archiveMessageShown = true;
  if (!action) return;
  const button = document.createElement('button');
  button.className = 'wide ghost';
  button.style.marginTop = '8px';
  button.textContent = action.label;
  button.addEventListener('click', action.run);
  arch.note.append(button);
}

/** The archive currently on screen, and null when the one asked for is not available. */
function shownArchive(): Archive | null {
  if (archiveScope === 'all') return community?.archive ?? null;
  return state.pool?.archive ?? null;
}

async function loadCommunity(): Promise<void> {
  if (communityLoading) return;
  communityLoading = true;
  const result = reported(await api.getCommunity());
  communityLoading = false;

  if (!result.ok) {
    // No server is a normal state, not an error state — every other panel behaves this way and
    // this one does too. Fall back to the local map and say why in one line.
    //
    // **The button is not disabled.** The first version disabled it, which turned a transient
    // failure into a permanently dead control: nothing else here retries, so once the server
    // came back there was no way to reach the shared map short of a reload. A failure that can
    // fix itself needs an affordance that can act on it.
    archiveScope = 'mine';
    syncScopeButtons();
    arch.all.title = 'The server is not answering — click to try again';
    setArchNote(
      'The shared map needs the server, and it is not answering. Click Everyone again to ' +
      'retry. Everything else here still works — evolution never leaves the browser.',
    );
    archivePainted = -1;
    return;
  }

  community = buildCommunity(result.data.cells, result.data.runs);
  archivePainted = -1;
  paintCommunityNote();
}

function paintCommunityNote(): void {
  if (community === null) return;
  const shared = overlapOf(state.pool?.archive ?? null, community.archive);
  const filled = community.archive.filled;

  if (filled === 0) {
    setArchNote(
      'Nobody has published a run yet, so the shared map is empty. Save a run and share it, ' +
      'and its elites land here.',
    );
    return;
  }

  const runs = `${community.runs} published ${community.runs === 1 ? 'run' : 'runs'}`;
  const yours = shared.size === 0
    ? 'Your run has not reached any of them yet.'
    : `Outlined: the ${shared.size} your own run also found.`;
  setArchNote(
    `Every kind of gait anybody has published, merged into one grid — ${filled} cells from ` +
    `${runs}. ${yours} Click a cell to load that gait.`,
  );
}

function syncScopeButtons(): void {
  arch.mine.classList.toggle('on', archiveScope === 'mine');
  arch.all.classList.toggle('on', archiveScope === 'all');
  arch.all.title = 'The merged map of every published run';
}

function setArchiveScope(scope: 'mine' | 'all'): void {
  if (archiveScope === scope) return;
  archiveScope = scope;
  archiveHover = null;
  archivePainted = -1;
  syncScopeButtons();

  if (scope === 'mine') {
    setArchNote(archNoteMine);
    return;
  }
  if (community === null) {
    setArchNote('Fetching the shared map…');
    void loadCommunity();
  } else {
    paintCommunityNote();
  }
}

arch.mine.addEventListener('click', () => setArchiveScope('mine'));
arch.all.addEventListener('click', () => setArchiveScope('all'));

function paintArchive(): void {
  const a = shownArchive();
  if (!a) return;
  // The map is not present in the guided flow, where the canvas measures zero. Painting a
  // zero-width canvas is harmless and pointless; skipping also means the first paint after
  // switching to Explorer happens at the right size rather than being cached at 24 pixels.
  if (archiveCanvas.clientWidth === 0) return;

  // Repaint on a cell change, a resize, a hover move or a scope change — not on every frame.
  // At four workers the map changes a few times a second and the replay runs at sixty, so this
  // is the difference between one blit a second and sixty.
  //
  // The pool's revision is in the key for *both* scopes. The shared map never changes on its
  // own, but the outline over it is your own map, so a running search has to redraw it — the
  // first version keyed the shared map on a constant and the outline sat frozen at whatever it
  // was when the map was fetched.
  const poolRevision = state.pool?.archiveRevision ?? 0;
  const revision =
    (poolRevision * 2 + (archiveScope === 'all' ? 1 : 0)) * 4096 + (archiveHover ?? 4095);
  if (revision !== archivePainted) {
    const rect = archiveCanvas.getBoundingClientRect();
    // Only the shared map is outlined: on your own map every filled cell is yours, and
    // outlining all of them would say nothing.
    const outline = archiveScope === 'all' && community
      ? overlapOf(state.pool?.archive ?? null, community.archive)
      : null;
    archiveView = drawArchive(actx, a, rect.width, rect.height, archiveHover, outline);
    // The caption counts the same outlined cells, so it moves with them rather than staying at
    // whatever it said when the map arrived.
    if (archiveScope === 'all' && !archiveMessageShown) paintCommunityNote();
    archivePainted = revision;
  }

  const best = a.filled > 0 ? Math.max(...a.cells.map((c) => c?.fitness ?? 0)) : 0;
  arch.cov.textContent = a.filled === 0
    ? 'nothing yet'
    : `${a.filled} of ${a.cells.length} cells`;
  arch.pct.textContent = `${(archiveCoverage(a) * 100).toFixed(1)}%`;
  arch.best.textContent = a.filled > 0 ? best.toFixed(3) : '—';
  arch.qd.textContent = a.filled > 0 ? archiveQd(a).toFixed(1) : '—';
  // Improvements per offer. It falls steadily through a run, and watching it fall is a
  // clearer signal that the search has stopped exploring than a flat best-fitness line —
  // best fitness can sit still while the map is still filling. Meaningless on a merged map,
  // where the offers happened in other people's browsers.
  arch.rate.textContent = archiveScope === 'all'
    ? '—'
    : a.attempts > 0 ? `${((a.improvements / a.attempts) * 100).toFixed(0)}% of trials` : '—';
}

function archiveHitAt(e: MouseEvent): ReturnType<typeof cellAt> {
  const a = shownArchive();
  if (!a || !archiveView) return null;
  const rect = archiveCanvas.getBoundingClientRect();
  return cellAt(a, archiveView, e.clientX - rect.left, e.clientY - rect.top);
}

archiveCanvas.addEventListener('mousemove', (e) => {
  const hit = archiveHitAt(e);
  archiveHover = hit?.index ?? null;
  if (!hit) {
    archiveCanvas.title = '';
    return;
  }
  const where =
    `stride ${hit.cell.behaviour[0].toFixed(2)} m · duty ${hit.cell.behaviour[1].toFixed(2)}` +
    ` · fitness ${hit.cell.fitness.toFixed(3)}`;
  // A generation number means nothing across runs, so the shared map names the run instead.
  const origin = archiveScope === 'all' ? community?.origins.get(hit.index) : undefined;
  archiveCanvas.title = archiveScope === 'all'
    ? `${where}${origin ? ` · from "${origin.runTitle}"` : ''}`
    : `${where} · found at generation ${hit.cell.generation}`;
});

archiveCanvas.addEventListener('mouseleave', () => {
  archiveHover = null;
});

archiveCanvas.addEventListener('click', (e) => {
  const hit = archiveHitAt(e);
  if (!hit) return;

  // Loading a cell into the sliders rather than into a fourth replay mode. It reuses the
  // path "Copy champion to sliders" already takes, and it puts the genome somewhere the
  // reader can then take apart — which is the whole reason the archive stores genomes and
  // not just fitness.
  state.manualGait = decodeGenome(hit.cell.genes);
  panel.sync(state.manualGait);
  setMode('manual');
  queueUrl();

  if (archiveScope !== 'all') return;

  /*
    A genome only means something against a body, and this is where that bites.

    Slice 7 fixed the topology at six joints so a gait could be dropped onto a different set of
    legs. Here it happens with somebody else's robot: eleven numbers that strode 0.92 m on their
    biped may be a face-plant on this one. That is not a defect to hide — it is the coupling
    between body and controller, demonstrated rather than described — but it has to be *said*,
    or the app looks broken at the exact moment it is being most instructive.
  */
  const origin = community?.origins.get(hit.index);
  const theirs = origin?.bodySpec ?? '';
  if (theirs === '' || theirs === encodeSpec(spec)) {
    setArchMessage('Loaded. Same body as yours, so it should behave as it did for them.');
    return;
  }
  setArchMessage(
    'Loaded — but this gait was evolved on a different body. The genome is eleven numbers ' +
    'and it does not know how long your legs are, so on this robot it may not walk at all.',
    {
      label: 'Use the body it was evolved on',
      run: () => {
        applySpec(clampSpec(decodeSpec(theirs, DEFAULT_SPEC)));
        setArchMessage('Their body loaded. Press Run to evolve from here, or edit it back.');
      },
    },
  );
});

function paintStats(): void {
  expireScorecard();
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
  editor.update(spec, state.champion !== null);
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
  setView(state.view);
  startPool();
  setMode('manual');
  queueUrl();

  // Both are fire-and-forget. With no server they fail, get recorded for the indicator, and
  // change nothing else — which is the whole rule of this slice.
  const shared = params.get('shared');
  if (shared) void openSharedRun(shared);
  void refreshRuns();

  // Last, because several panels build their own header and the `?` needs somewhere to go.
  // A missing header is a wiring bug rather than a state — a `?` that quietly stops appearing
  // is worse than one that never did — so it is said out loud rather than swallowed.
  const missing = attachHelpButtons(help);
  if (missing.length > 0) {
    console.error(`help: no panel header found for ${missing.join(', ')}`);
  }

  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
void boot();
