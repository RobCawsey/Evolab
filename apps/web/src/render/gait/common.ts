/**
 * What the gait panels share: a palette, and — more importantly — **one time axis**.
 *
 * The footfall diagram and the joint traces are stacked, read together, and carry a playhead
 * each. If they computed their own x-mapping, two panels sitting a few pixels apart would
 * disagree about where 2.4 seconds is, and the whole point of stacking them is that a reader
 * can draw a vertical line down the screen with their eye. So the mapping lives here and both
 * import it.
 *
 * Hand-rolled canvas, same as `chart.ts` and `archive.ts`. Nothing here owns a clock: every
 * function takes the frame `main.ts` is already holding.
 */

import type { Recording } from '@evolab/sim';

export const GAIT_COLOURS = {
  grid: '#1f1e2b',
  axis: '#2c2a3a',
  label: '#5c5871',
  text: '#8c8899',
  playhead: '#e9a13b',
  /** Near leg — matches the 2D renderer and the 3D scene, so a colour means one leg everywhere. */
  near: '#4ea8c4',
  far: '#8b7bd8',
  hip: '#e9a13b',
  knee: '#4ea8c4',
  ankle: '#4fb48c',
} as const;

export const GAIT_PAD = { left: 44, right: 12, top: 10, bottom: 18 } as const;

export interface Plot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function plotRect(width: number, height: number): Plot {
  return {
    x: GAIT_PAD.left,
    y: GAIT_PAD.top,
    w: Math.max(1, width - GAIT_PAD.left - GAIT_PAD.right),
    h: Math.max(1, height - GAIT_PAD.top - GAIT_PAD.bottom),
  };
}

/** Frame index → pixel x. The single definition of where a moment in time is on screen. */
export function frameToX(plot: Plot, rec: Recording, frame: number): number {
  const span = Math.max(1, rec.frames - 1);
  return plot.x + (Math.max(0, Math.min(span, frame)) / span) * plot.w;
}

/**
 * Pixel x → frame index, for click-to-seek. The exact inverse of `frameToX`.
 *
 * Clamped to a frame that actually exists. The `max(1, …)` that keeps a one-frame recording
 * from dividing by zero would otherwise let a click at the right-hand edge return frame 1 of
 * a recording that only has frame 0 — harmless downstream, because `snapshotAt` clamps too,
 * but a function that can name a frame nobody has is a trap for the next caller.
 */
export function xToFrame(plot: Plot, rec: Recording, x: number): number {
  const last = Math.max(0, rec.frames - 1);
  const span = Math.max(1, last);
  const t = (x - plot.x) / plot.w;
  return Math.min(last, Math.round(Math.max(0, Math.min(1, t)) * span));
}

/** Vertical ticks every whole second, so a reader can count cycles without a legend. */
export function drawTimeGrid(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  rec: Recording,
  labels: boolean,
): void {
  const seconds = (rec.frames - 1) / rec.hz;
  ctx.strokeStyle = GAIT_COLOURS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let s = 0; s <= Math.floor(seconds); s++) {
    const x = Math.round(frameToX(plot, rec, s * rec.hz)) + 0.5;
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
  }
  ctx.stroke();

  if (!labels) return;
  ctx.fillStyle = GAIT_COLOURS.label;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (let s = 0; s <= Math.floor(seconds); s++) {
    ctx.fillText(`${s}s`, frameToX(plot, rec, s * rec.hz), plot.y + plot.h + 12);
  }
}

/** The playhead. Drawn last, over everything, because it is what the reader is tracking. */
export function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  rec: Recording,
  frame: number,
): void {
  const x = Math.round(frameToX(plot, rec, frame)) + 0.5;
  ctx.strokeStyle = GAIT_COLOURS.playhead;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, plot.y - 2);
  ctx.lineTo(x, plot.y + plot.h + 2);
  ctx.stroke();
}

/** Panel title, top-left inside the plot. Cheaper than a heading element per panel. */
export function drawTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.fillStyle = GAIT_COLOURS.text;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(text, x, y);
}
