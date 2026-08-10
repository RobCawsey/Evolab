/**
 * The guided first run — Fig 9.1.
 *
 * Four steps, one decision visible at a time, and no slider anywhere. The measure of this
 * screen is whether somebody who has never seen the project reaches an evolved gait without
 * being told what to do, and can then get to the full instrument in one click.
 *
 * Deliberately not React. See the slice 6 notes in docs/implementation.md — the panels here
 * are a staged reveal driven by four booleans, and porting a thousand lines of working,
 * tested UI to buy that would be work with no user on the other end of it.
 */

import { PRESETS, type Preset, type RunOutcome } from '../run/objectives.ts';

export interface GuidedView {
  /** Champion distance, or null before anything has evolved. */
  readonly championDistance: number | null;
  readonly firstDistance: number | null;
  readonly generation: number;
  readonly target: number;
  readonly running: boolean;
  readonly ready: boolean;
  readonly preset: Preset;
  readonly watching: 'first' | 'champion';
  readonly trials: number;
  /** The champion trial, for copy that reads the result instead of predicting it. */
  readonly outcome: RunOutcome | null;
}

export interface GuidedHandlers {
  onPreset(preset: Preset): void;
  onRun(): void;
  onWatch(which: 'first' | 'champion'): void;
  onStepper(): void;
  onExplorer(): void;
}

export interface GuidedPanel {
  update(view: GuidedView): void;
}

export function createGuided(host: HTMLElement, handlers: GuidedHandlers): GuidedPanel {
  host.innerHTML = `
    <div class="gd-step" data-step="1">
      <div class="gd-head"><span class="gd-n">1</span><b>Pick a body</b><em id="gd-s1"></em></div>
      <div class="gd-body">
        <div class="gd-card on">
          <b>Simple biped</b>
          <span>7 segments · 6 joints · 21 kg · 0.92 m tall</span>
        </div>
        <p class="gd-note">The only body for now. You will be able to build your own later.</p>
      </div>
    </div>

    <div class="gd-step" data-step="2">
      <div class="gd-head"><span class="gd-n">2</span><b>Choose a goal</b><em id="gd-s2"></em></div>
      <div class="gd-body">
        <div id="gd-presets" class="gd-presets"></div>
        <p class="gd-note" id="gd-blurb"></p>
      </div>
    </div>

    <div class="gd-step" data-step="3">
      <div class="gd-head"><span class="gd-n">3</span><b>Watch 24 robots evolve</b><em id="gd-s3"></em></div>
      <div class="gd-body">
        <button id="gd-run" class="pri wide">Start evolving</button>
        <span class="gauge"><i id="gd-progress" style="width:0%"></i></span>
        <div class="kv"><span>generation</span><b id="gd-gen">0 / 30</b></div>
        <div class="kv"><span>robots tried</span><b id="gd-trials">0</b></div>
        <p class="gd-note">
          Nobody designs the walk. Each generation keeps what worked and nudges it.
        </p>
      </div>
    </div>

    <div class="gd-step" data-step="4">
      <div class="gd-head"><span class="gd-n">4</span><b>See what changed</b><em id="gd-s4"></em></div>
      <div class="gd-body">
        <div class="seg wide">
          <button id="gd-first">First attempt</button>
          <button id="gd-champ" class="on">Best found</button>
        </div>
        <div class="kv"><span>first attempt</span><b id="gd-d0">—</b></div>
        <div class="kv"><span>best found</span><b class="am" id="gd-d1">—</b></div>
        <div class="kv"><span>improvement</span><b class="ok" id="gd-imp">—</b></div>
        <p class="gd-note" id="gd-afterword"></p>
        <button id="gd-stepper" class="wide">Show me how this works →</button>
        <button id="gd-explorer" class="wide ghost">Open the full interface</button>
      </div>
    </div>`;

  const el = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;

  // --- preset buttons ---
  const presets = el('gd-presets');
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.className = 'gd-preset';
    button.dataset['key'] = preset.key;
    button.innerHTML = `<b>${preset.name}</b><span>${preset.teaches}</span>`;
    button.addEventListener('click', () => handlers.onPreset(preset));
    presets.append(button);
  }

  el('gd-run').addEventListener('click', () => handlers.onRun());
  el('gd-first').addEventListener('click', () => handlers.onWatch('first'));
  el('gd-champ').addEventListener('click', () => handlers.onWatch('champion'));
  el('gd-stepper').addEventListener('click', () => handlers.onStepper());
  el('gd-explorer').addEventListener('click', () => handlers.onExplorer());

  /**
   * `ready` is expanded but unbadged — a step you can act on that is not the one being
   * pointed at. Without it, step 3 stays collapsed until the run has started and the
   * button that starts the run is inside it, which is a flow with no way through.
   */
  function setState(step: number, state: 'done' | 'now' | 'ready' | 'next'): void {
    const node = host.querySelector<HTMLElement>(`.gd-step[data-step="${step}"]`);
    node?.classList.toggle('on', state === 'now');
    node?.classList.toggle('done', state === 'done');
    node?.classList.toggle('later', state === 'next');
    const badge = el(`gd-s${step}`);
    badge.textContent = state === 'done' ? 'done' : state === 'now' ? 'now' : '';
    badge.className = state === 'done' ? 'ok' : state === 'now' ? 'am' : '';
  }

  return {
    update(v: GuidedView): void {
      const started = v.generation > 0 || v.running;
      const finished = v.generation >= v.target && v.generation > 0;

      setState(1, 'done');
      setState(2, started ? 'done' : 'now');
      setState(3, finished ? 'done' : started ? 'now' : 'ready');
      setState(4, finished ? 'now' : 'next');

      for (const button of presets.querySelectorAll<HTMLElement>('.gd-preset')) {
        button.classList.toggle('on', button.dataset['key'] === v.preset.key);
      }
      el('gd-blurb').textContent = v.preset.blurb;

      const run = el<HTMLButtonElement>('gd-run');
      run.textContent = v.running ? 'Pause' : finished ? 'Run it again' : 'Start evolving';
      run.disabled = !v.ready;

      el('gd-gen').textContent = `${v.generation} / ${v.target}`;
      el('gd-trials').textContent = String(v.trials);
      el('gd-progress').style.width = `${Math.min(100, (v.generation / v.target) * 100)}%`;

      el('gd-first').classList.toggle('on', v.watching === 'first');
      el('gd-champ').classList.toggle('on', v.watching === 'champion');

      const first = v.firstDistance;
      const best = v.championDistance;
      el('gd-d0').textContent = first === null ? '—' : `${first.toFixed(2)} m`;
      el('gd-d1').textContent = best === null ? '—' : `${best.toFixed(2)} m`;
      el('gd-imp').textContent =
        first === null || best === null || Math.abs(first) < 0.01
          ? '—'
          : `${(best - first).toFixed(2)} m further`;

      // The afterword is the payload of the naive-goal lesson, and it must not appear
      // before the learner has seen the result for themselves.
      el('gd-afterword').textContent =
        finished && v.outcome && v.preset.afterword ? v.preset.afterword(v.outcome) : '';
    },
  };
}
