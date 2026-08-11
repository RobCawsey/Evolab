/**
 * Hip phase portrait — Fig 9.7, note 3. Angle on x, angular velocity on y.
 *
 * The panel that looks most impressive and teaches least, which is worth saying out loud. A
 * converged gait draws a closed loop, because a periodic motion returns to the same angle at
 * the same speed every cycle; a gait that is still falling over draws a spiral that never
 * closes. That is a genuinely good picture of *periodicity*, and periodicity is the one
 * property the footfall diagram does not show directly.
 *
 * It has no time axis, so it does not share `common.ts`'s mapping — the playhead here is a
 * dot on the curve rather than a vertical line.
 */

import type { Recording } from '@evolab/sim';
import { GAIT_COLOURS, GAIT_PAD, drawTitle, plotRect } from './common.ts';

const DEG = 180 / Math.PI;

/** Angular velocity by finite difference, in rad/s. The recording is evenly sampled. */
function velocity(rec: Recording, jointIndex: number, frame: number): number {
  const nj = rec.joints.length;
  const a = Math.max(0, Math.min(rec.frames - 1, frame));
  const b = Math.min(rec.frames - 1, a + 1);
  if (a === b) return 0;
  return (rec.jointAngles[b * nj + jointIndex]! - rec.jointAngles[a * nj + jointIndex]!) * rec.hz;
}

export function drawPortrait(
  ctx: CanvasRenderingContext2D,
  rec: Recording,
  frame: number,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  const jointIndex = rec.joints.indexOf('hipL');
  if (rec.frames < 2 || jointIndex < 0) return;

  const plot = plotRect(width, height);
  const nj = rec.joints.length;

  let peakA = 0;
  let peakV = 0;
  for (let f = 0; f < rec.frames; f++) {
    peakA = Math.max(peakA, Math.abs(rec.jointAngles[f * nj + jointIndex]!));
    peakV = Math.max(peakV, Math.abs(velocity(rec, jointIndex, f)));
  }
  peakA = Math.max(peakA, 0.1);
  peakV = Math.max(peakV, 0.1);

  const xOf = (a: number) => plot.x + plot.w / 2 + (a / peakA) * (plot.w / 2 - 4);
  const yOf = (v: number) => plot.y + plot.h / 2 - (v / peakV) * (plot.h / 2 - 4);

  // Axes through the origin: the resting state is the centre, and a gait that never returns
  // to it is one that never stops moving.
  ctx.strokeStyle = GAIT_COLOURS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, Math.round(yOf(0)) + 0.5);
  ctx.lineTo(plot.x + plot.w, Math.round(yOf(0)) + 0.5);
  ctx.moveTo(Math.round(xOf(0)) + 0.5, plot.y);
  ctx.lineTo(Math.round(xOf(0)) + 0.5, plot.y + plot.h);
  ctx.stroke();

  // The trajectory, fading from dim to bright so the direction of travel is visible. Drawn
  // as segments rather than one path because a single path cannot change colour.
  for (let f = 1; f < rec.frames; f++) {
    const t = f / (rec.frames - 1);
    ctx.strokeStyle = `rgba(78, 168, 196, ${0.15 + t * 0.6})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xOf(rec.jointAngles[(f - 1) * nj + jointIndex]!), yOf(velocity(rec, jointIndex, f - 1)));
    ctx.lineTo(xOf(rec.jointAngles[f * nj + jointIndex]!), yOf(velocity(rec, jointIndex, f)));
    ctx.stroke();
  }

  // The playhead is a dot on the curve — the state the replay is in right now.
  const f = Math.max(0, Math.min(rec.frames - 1, Math.round(frame)));
  ctx.fillStyle = GAIT_COLOURS.playhead;
  ctx.beginPath();
  ctx.arc(xOf(rec.jointAngles[f * nj + jointIndex]!), yOf(velocity(rec, jointIndex, f)), 3, 0, Math.PI * 2);
  ctx.fill();

  drawTitle(ctx, 'left hip · angle vs rate', plot.x, plot.y - 1);
  ctx.fillStyle = GAIT_COLOURS.label;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`±${(peakA * DEG).toFixed(0)}°`, plot.x + plot.w / 2, plot.y + plot.h + 12);
  ctx.save();
  ctx.translate(GAIT_PAD.left - 30, plot.y + plot.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`±${peakV.toFixed(1)} rad/s`, 0, 0);
  ctx.restore();
}
