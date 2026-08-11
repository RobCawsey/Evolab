/**
 * Joint-angle traces — Fig 9.7, note 2. Six series on one shared y-axis.
 *
 * One axis rather than six stacked strips, because the comparison worth making is *between*
 * joints: the hip leads, the knee follows, and the ankle does almost nothing on most evolved
 * gaits. Six separate scales would hide exactly that, by making a 4° ankle wiggle look the
 * same size as a 40° hip sweep.
 *
 * Colour is by joint kind — hip amber, knee cyan, ankle green — and the far leg is drawn
 * dashed rather than in a seventh colour, so a reader tracks three shapes and not six.
 */

import type { Recording } from '@evolab/sim';
import {
  GAIT_COLOURS, drawPlayhead, drawTimeGrid, drawTitle, frameToX, plotRect,
} from './common.ts';

const DEG = 180 / Math.PI;

function colourFor(jointId: string): string {
  if (jointId.startsWith('hip')) return GAIT_COLOURS.hip;
  if (jointId.startsWith('knee')) return GAIT_COLOURS.knee;
  return GAIT_COLOURS.ankle;
}

export function drawTraces(
  ctx: CanvasRenderingContext2D,
  rec: Recording,
  frame: number,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (rec.frames === 0 || rec.joints.length === 0) return;

  const plot = plotRect(width, height);
  const nj = rec.joints.length;

  // Symmetric range about zero so the rest pose is the centre line and a joint that swings
  // one way only is visibly doing so, rather than being re-centred into looking balanced.
  let peak = 0;
  for (let i = 0; i < rec.jointAngles.length; i++) {
    const a = Math.abs(rec.jointAngles[i]!);
    if (a > peak) peak = a;
  }
  peak = Math.max(peak, 0.2);
  const yOf = (angle: number) => plot.y + plot.h / 2 - (angle / peak) * (plot.h / 2 - 4);

  drawTimeGrid(ctx, plot, rec, false);

  // Zero line — the rest pose, and the thing every trace is read against.
  ctx.strokeStyle = GAIT_COLOURS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, Math.round(yOf(0)) + 0.5);
  ctx.lineTo(plot.x + plot.w, Math.round(yOf(0)) + 0.5);
  ctx.stroke();

  for (let j = 0; j < nj; j++) {
    const id = rec.joints[j]!;
    ctx.strokeStyle = colourFor(id);
    ctx.lineWidth = 1.25;
    ctx.setLineDash(id.endsWith('R') ? [3, 3] : []);
    ctx.beginPath();
    for (let f = 0; f < rec.frames; f++) {
      const x = frameToX(plot, rec, f);
      const y = yOf(rec.jointAngles[f * nj + j]!);
      if (f === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Scale labels in degrees. Radians are the project's unit everywhere else, but nobody
  // reads a gait in radians and this panel exists to be read.
  ctx.fillStyle = GAIT_COLOURS.label;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`+${(peak * DEG).toFixed(0)}°`, plot.x - 6, plot.y + 8);
  ctx.fillText('0', plot.x - 6, yOf(0) + 3);
  ctx.fillText(`−${(peak * DEG).toFixed(0)}°`, plot.x - 6, plot.y + plot.h - 1);

  drawTitle(ctx, 'joint angles · solid left, dashed right', plot.x, plot.y - 1);

  // Legend, inline at the right so it costs no vertical space.
  const legend: [string, string][] = [
    ['hip', GAIT_COLOURS.hip], ['knee', GAIT_COLOURS.knee], ['ankle', GAIT_COLOURS.ankle],
  ];
  ctx.textAlign = 'right';
  let lx = plot.x + plot.w;
  for (const [name, colour] of [...legend].reverse()) {
    ctx.fillStyle = colour;
    ctx.fillText(name, lx, plot.y - 1);
    lx -= ctx.measureText(name).width + 10;
  }

  drawPlayhead(ctx, plot, rec, frame);
}
