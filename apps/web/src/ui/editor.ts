/**
 * The body editor — Fig 9.3.
 *
 * Edits a `BipedSpec` rather than raw segments, so the kinematic chain closes by
 * construction and there is no way to build a body whose joints tear themselves together on
 * the first step. Validation is therefore about whether a body can *work*, not whether it is
 * structurally coherent.
 *
 * The topology is fixed at six joints, which keeps the genome at eleven genes — so a gait
 * evolved on one body can be dropped onto another. Lengthening the legs and watching a gait
 * that used to work fall over is the most instructive thing here, and it is only possible
 * because the editor refuses to change the joint count.
 */

import {
  DEFAULT_SPEC,
  SPEC_RANGES,
  bodyStats,
  buildBiped,
  validateBody,
  type BipedSpec,
} from '@evolab/evolution';

export interface EditorHandlers {
  onChange(spec: BipedSpec): void;
  onReset(): void;
  onRetest(): void;
}

export interface EditorPanel {
  update(spec: BipedSpec, hasChampion: boolean): void;
}

interface Row {
  readonly input: HTMLInputElement;
  readonly out: HTMLElement;
  readonly read: (s: BipedSpec) => number;
  readonly write: (s: BipedSpec, v: number) => BipedSpec;
  readonly unit: string;
  readonly decimals: number;
}

export function createEditor(host: HTMLElement, handlers: EditorHandlers): EditorPanel {
  let spec = DEFAULT_SPEC;
  const rows: Row[] = [];

  host.innerHTML = `
    <div class="ph" id="ph-editor">Body<span class="sp"></span><em>symmetric · 6 joints</em></div>
    <div class="ed-body" id="ed-rows"></div>
    <div class="ph">Measurements</div>
    <div class="stats" id="ed-stats">
      <div class="kv"><span>mass</span><b id="ed-mass">—</b></div>
      <div class="kv"><span>standing height</span><b id="ed-height">—</b></div>
      <div class="kv"><span>balance margin</span><b id="ed-margin">—</b></div>
      <div class="kv"><span>hip load</span><b id="ed-load">—</b></div>
    </div>
    <div id="ed-issues" class="ed-issues"></div>
    <div class="stats">
      <button id="ed-retest" class="wide">Re-test the champion on this body</button>
      <button id="ed-reset" class="wide ghost">Back to the reference body</button>
      <p class="gd-note">
        Changing the body does not change the genome — the joint count is fixed, so an
        evolved gait can be dropped straight onto a different set of legs. It will usually
        fall over, which is the point.
      </p>
    </div>`;

  const el = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const rowHost = el('ed-rows');

  function group(title: string): void {
    const head = document.createElement('div');
    head.className = 'sl-head';
    head.textContent = title;
    rowHost.append(head);
  }

  function slider(
    label: string,
    [min, max]: readonly [number, number],
    read: (s: BipedSpec) => number,
    write: (s: BipedSpec, v: number) => BipedSpec,
    unit = ' m',
    decimals = 3,
  ): void {
    const wrap = document.createElement('label');
    wrap.className = 'sl';

    const name = document.createElement('span');
    name.className = 'sl-name';
    name.textContent = label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String((max - min) / 400);
    input.value = String(read(spec));

    const out = document.createElement('b');
    out.className = 'sl-val';
    out.textContent = read(spec).toFixed(decimals) + unit;

    input.addEventListener('input', () => {
      spec = write(spec, Number(input.value));
      handlers.onChange(spec);
    });

    wrap.append(name, input, out);
    rowHost.append(wrap);
    rows.push({ input, out, read, write, unit, decimals });
  }

  group('torso');
  slider('length', SPEC_RANGES.torso.length, (s) => s.torso.length,
    (s, v) => ({ ...s, torso: { ...s.torso, length: v } }));
  slider('width', SPEC_RANGES.torso.width, (s) => s.torso.width,
    (s, v) => ({ ...s, torso: { ...s.torso, width: v } }));

  group('thigh');
  slider('length', SPEC_RANGES.thigh.length, (s) => s.thigh.length,
    (s, v) => ({ ...s, thigh: { ...s.thigh, length: v } }));
  slider('width', SPEC_RANGES.thigh.width, (s) => s.thigh.width,
    (s, v) => ({ ...s, thigh: { ...s.thigh, width: v } }));

  group('shank');
  slider('length', SPEC_RANGES.shank.length, (s) => s.shank.length,
    (s, v) => ({ ...s, shank: { ...s.shank, length: v } }));
  slider('width', SPEC_RANGES.shank.width, (s) => s.shank.width,
    (s, v) => ({ ...s, shank: { ...s.shank, width: v } }));

  group('foot');
  slider('length', SPEC_RANGES.foot.length, (s) => s.foot.length,
    (s, v) => ({ ...s, foot: { ...s.foot, length: v } }));
  slider('height', SPEC_RANGES.foot.height, (s) => s.foot.height,
    (s, v) => ({ ...s, foot: { ...s.foot, height: v } }));
  slider('ankle offset', SPEC_RANGES.foot.ankleOffset, (s) => s.foot.ankleOffset,
    (s, v) => ({ ...s, foot: { ...s.foot, ankleOffset: v } }));

  group('material');
  slider('density', SPEC_RANGES.density, (s) => s.density,
    (s, v) => ({ ...s, density: v }), ' kg/m²', 0);

  el('ed-reset').addEventListener('click', () => handlers.onReset());
  el('ed-retest').addEventListener('click', () => handlers.onRetest());

  return {
    update(next: BipedSpec, hasChampion: boolean): void {
      spec = next;
      for (const row of rows) {
        const v = row.read(spec);
        row.input.value = String(v);
        row.out.textContent = v.toFixed(row.decimals) + row.unit;
      }

      const morph = buildBiped(spec);
      const stats = bodyStats(morph);
      el('ed-mass').textContent = `${stats.mass.toFixed(1)} kg`;
      el('ed-height').textContent = `${stats.standingHeight.toFixed(2)} m`;
      el('ed-margin').textContent = `${(stats.margin * 1000).toFixed(0)} mm`;
      el('ed-margin').className = stats.margin <= 0 ? 'bad' : stats.margin < 0.015 ? 'am' : 'ok';
      el('ed-load').textContent = `${(stats.hipLoad * 100).toFixed(0)}%`;
      el('ed-load').className = stats.hipLoad > 1 ? 'bad' : stats.hipLoad > 0.7 ? 'am' : 'ok';

      const issues = validateBody(morph);
      el('ed-issues').replaceChildren(
        ...issues.map((issue) => {
          const node = document.createElement('p');
          node.className = `ed-issue ${issue.level}`;
          node.textContent = issue.text;
          return node;
        }),
      );

      el<HTMLButtonElement>('ed-retest').disabled = !hasChampion;
    },
  };
}

/* ---------------- URL round-trip ---------------- */

/** Eleven numbers, same idea as the gait encoding: short enough to paste into a chat. */
export function encodeSpec(s: BipedSpec): string {
  return [
    s.torso.length, s.torso.width,
    s.thigh.length, s.thigh.width,
    s.shank.length, s.shank.width,
    s.foot.length, s.foot.height, s.foot.ankleOffset,
    s.density,
  ].map((v) => v.toFixed(4)).join(',');
}

export function decodeSpec(text: string, fallback: BipedSpec): BipedSpec {
  const n = text.split(',').map(Number);
  if (n.length !== 10 || n.some((v) => !Number.isFinite(v))) return fallback;
  return {
    torso: { length: n[0]!, width: n[1]! },
    thigh: { length: n[2]!, width: n[3]! },
    shank: { length: n[4]!, width: n[5]! },
    foot: { length: n[6]!, height: n[7]!, ankleOffset: n[8]! },
    density: n[9]!,
    limits: fallback.limits,
    maxTorque: fallback.maxTorque,
  };
}
