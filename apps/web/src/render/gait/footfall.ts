/**
 * The footfall diagram — Fig 9.7, note 1. Two bars, filled where the foot is on the ground.
 *
 * This is the panel that earns the slice. Duty factor stops being a number on the behaviour
 * map and becomes **the fraction of the bar that is filled**; the phase offset between the two
 * feet becomes visibly the thing that separates a walk from a hop. Everything it draws was
 * already captured by slice 9's recorder, so it costs no simulation at all.
 *
 * The duty figure printed on it comes from `dutyFromRecording` in `packages/sim`, which is the
 * same function a test holds against `TrialResult.dutyFactor`. A diagram claiming one duty
 * while the map beside it claims another would be worse than no diagram.
 */

import { dutyFromRecording, dutyPerFoot, type Recording } from '@evolab/sim';
import {
  GAIT_COLOURS, drawPlayhead, drawTimeGrid, drawTitle, frameToX, plotRect,
} from './common.ts';

export function drawFootfall(
  ctx: CanvasRenderingContext2D,
  rec: Recording,
  frame: number,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (rec.frames === 0) return;

  const plot = plotRect(width, height);
  drawTimeGrid(ctx, plot, rec, true);

  // Two lanes with a gap. Left on top because the near leg is the one drawn in front.
  const laneH = Math.max(6, (plot.h - 10) / 2);
  const lanes = [
    { foot: 0 as const, y: plot.y, colour: GAIT_COLOURS.near, label: 'left' },
    { foot: 1 as const, y: plot.y + laneH + 10, colour: GAIT_COLOURS.far, label: 'right' },
  ];

  const pxPerFrame = plot.w / Math.max(1, rec.frames - 1);

  for (const lane of lanes) {
    // The empty lane, so a swing phase reads as a gap rather than as missing data.
    ctx.fillStyle = '#15141f';
    ctx.fillRect(plot.x, lane.y, plot.w, laneH);

    // Contiguous stance runs drawn as single rectangles. One rect per frame would be 480
    // fills a repaint and would show seams between abutting edges at fractional widths.
    ctx.fillStyle = lane.colour;
    let runStart = -1;
    for (let f = 0; f < rec.frames; f++) {
      const down = rec.contact[f * 2 + lane.foot] === 1;
      if (down && runStart < 0) runStart = f;
      if ((!down || f === rec.frames - 1) && runStart >= 0) {
        const end = down ? f : f - 1;
        const x0 = frameToX(plot, rec, runStart);
        const x1 = frameToX(plot, rec, end);
        ctx.fillRect(x0, lane.y, Math.max(1, x1 - x0 + pxPerFrame), laneH);
        runStart = -1;
      }
    }

    ctx.fillStyle = GAIT_COLOURS.label;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(lane.label, plot.x - 6, lane.y + laneH / 2 + 3);
  }

  const [dutyL, dutyR] = dutyPerFoot(rec);
  const duty = dutyFromRecording(rec);
  const seconds = (rec.frames - 1) / rec.hz;
  // The window is stated because the number is only comparable to the behaviour map's cell
  // if it was measured over the same trial. It is — `respawn` records exactly `trialSeconds`
  // — and saying so is what lets a reader trust the two agreeing rather than assume it.
  drawTitle(
    ctx,
    `footfall · duty ${duty.toFixed(2)} over ${seconds.toFixed(1)} s ` +
      `(L ${dutyL.toFixed(2)} · R ${dutyR.toFixed(2)})`,
    plot.x,
    plot.y - 1,
  );

  drawPlayhead(ctx, plot, rec, frame);
}
