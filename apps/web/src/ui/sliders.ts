/**
 * The gait slider panel. Plain DOM — React arrives at slice 6, when there are panels
 * worth componentising.
 *
 * Every slider is derived from GAIT_RANGES, so the space you can explore by hand is
 * exactly the space the genetic algorithm will search in slice 2. That equivalence is
 * the point of the exercise: you are about to lose a race against it, fairly.
 */

import {
  GAIT_RANGES,
  JOINT_KINDS,
  withJointParam,
  type GaitParams,
  type JointGait,
  type JointKind,
} from '@evolab/evolution';

const KEYS: readonly (keyof JointGait)[] = ['amplitude', 'phase', 'centre'];
const LABEL: Record<keyof JointGait, string> = {
  amplitude: 'amplitude',
  phase: 'phase',
  centre: 'centre',
};

export interface SliderPanel {
  /** Push external changes (a URL load, a reset) back into the inputs. */
  sync(params: GaitParams): void;
}

export function createSliders(
  host: HTMLElement,
  initial: GaitParams,
  onChange: (next: GaitParams) => void,
): SliderPanel {
  let current = initial;
  const inputs: { el: HTMLInputElement; out: HTMLElement; read: (p: GaitParams) => number }[] = [];

  // A panel header, added in slice 15. The gait controls were the one panel without one, which
  // left the busiest column in the app starting with an unlabelled row of sliders — and left
  // the `?` control nowhere to live on the panel a beginner needs it on most.
  const head = document.createElement('div');
  head.className = 'ph';
  head.id = 'ph-sliders';
  head.innerHTML = 'Gait controls<span class="sp"></span>';
  host.append(head);

  function row(
    label: string,
    min: number,
    max: number,
    read: (p: GaitParams) => number,
    write: (p: GaitParams, v: number) => GaitParams,
    unit = '',
  ): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'sl';

    const name = document.createElement('span');
    name.className = 'sl-name';
    name.textContent = label;

    const el = document.createElement('input');
    el.type = 'range';
    el.min = String(min);
    el.max = String(max);
    el.step = String((max - min) / 400);
    el.value = String(read(current));

    const out = document.createElement('b');
    out.className = 'sl-val';
    out.textContent = read(current).toFixed(2) + unit;

    el.addEventListener('input', () => {
      const v = Number(el.value);
      out.textContent = v.toFixed(2) + unit;
      current = write(current, v);
      onChange(current);
    });

    wrap.append(name, el, out);
    inputs.push({ el, out, read });
    return wrap;
  }

  const frag = document.createDocumentFragment();

  const freq = document.createElement('div');
  freq.className = 'sl-group';
  freq.append(
    heading('gait'),
    row(
      'frequency',
      GAIT_RANGES.frequency[0],
      GAIT_RANGES.frequency[1],
      (p) => p.frequency,
      (p, v) => ({ ...p, frequency: v }),
      ' Hz',
    ),
    row(
      'balance',
      GAIT_RANGES.balanceGain[0],
      GAIT_RANGES.balanceGain[1],
      (p) => p.balanceGain,
      (p, v) => ({ ...p, balanceGain: v }),
    ),
  );
  frag.append(freq);

  for (const kind of JOINT_KINDS) {
    const group = document.createElement('div');
    group.className = 'sl-group';
    group.append(heading(kind));
    for (const key of KEYS) {
      const [min, max] = GAIT_RANGES[kind][key];
      group.append(
        row(
          LABEL[key],
          min,
          max,
          (p) => p[kind][key],
          (p, v) => withJointParam(p, kind as JointKind, key, v),
        ),
      );
    }
    frag.append(group);
  }

  host.append(frag);

  return {
    sync(params: GaitParams): void {
      current = params;
      for (const i of inputs) {
        const v = i.read(params);
        i.el.value = String(v);
        i.out.textContent = v.toFixed(2) + (i.out.textContent?.endsWith('Hz') ? ' Hz' : '');
      }
    },
  };
}

function heading(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'sl-head';
  h.textContent = text;
  return h;
}

/* ---------------- URL persistence ---------------- */

/**
 * Gaits are worth sharing and worth surviving a reload, and ten numbers fit comfortably
 * in a query string. Order matches the genome layout in slice 2, deliberately.
 */
export function encodeGait(p: GaitParams): string {
  return gaitNumbers(p).map((v) => v.toFixed(3)).join(',');
}

/**
 * The same eleven numbers, at the precision a **recomputation** needs — slice 16.
 *
 * Three decimals is right for a URL, where brevity is the point and a gait only has to be
 * recognisable. It is wrong for a stored run, because reopening one now re-simulates the trial
 * from these numbers rather than downloading a recording, and three decimals is not enough to
 * land on the same trial.
 *
 * Measured: a champion saved at three decimals recomputed to a stride of 0.804 against the
 * 1.100 it was stored with. Stride is the most sensitive of the reported numbers because it
 * comes from footfall timing, and a thousandth of a radian of phase is enough to merge two
 * touchdowns into one. The same shape as slice 13's bin-boundary bug: rounding for the wire
 * costs reproducibility, and the wire is not where the rounding belongs.
 */
export function encodeGaitPrecise(p: GaitParams): string {
  return gaitNumbers(p).map((v) => v.toFixed(6)).join(',');
}

/** Order matches the genome layout in slice 2, deliberately. */
function gaitNumbers(p: GaitParams): number[] {
  return [
    p.frequency, p.balanceGain,
    p.hip.amplitude, p.hip.phase, p.hip.centre,
    p.knee.amplitude, p.knee.phase, p.knee.centre,
    p.ankle.amplitude, p.ankle.phase, p.ankle.centre,
  ];
}

export function decodeGait(text: string, fallback: GaitParams): GaitParams {
  const n = text.split(',').map(Number);
  if (n.length !== 11 || n.some((v) => !Number.isFinite(v))) return fallback;
  return {
    frequency: n[0]!,
    balanceGain: n[1]!,
    hip: { amplitude: n[2]!, phase: n[3]!, centre: n[4]! },
    knee: { amplitude: n[5]!, phase: n[6]!, centre: n[7]! },
    ankle: { amplitude: n[8]!, phase: n[9]!, centre: n[10]! },
  };
}
