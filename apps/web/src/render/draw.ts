/**
 * Canvas 2D renderer for a sim snapshot. Deliberately plain: no WebGL, no Three.js.
 * 3D arrives at slice 9, and not before (CLAUDE.md).
 */

import type { Snapshot } from '@evolab/sim';
import { fitCamera, toScreenX, toScreenY, type Camera } from './camera.ts';

/**
 * Render-only lateral offset for the far leg, in metres.
 *
 * The simulation is strictly sagittal: both legs occupy the same plane and, at the
 * symmetric rest pose, overlap exactly — which makes a biped look like a pogo stick until
 * it starts moving. Nudging the far limb when drawing restores the sense of two legs.
 *
 * This is a lie the renderer tells and nowhere else. Physics, fitness and every recorded
 * trajectory use the true position. Set it to 0 when checking a screen position against a
 * world coordinate.
 */
const FAR_LEG_RENDER_OFFSET = 0.055;

const COLOURS = {
  bg: '#0b0a11',
  grid: '#191826',
  ground: '#3a374a',
  tick: '#242232',
  body: '#e4e2ec',
  near: '#c9c5d8',
  far: '#4a4660',
  joint: '#e9a13b',
  jointFar: '#7a5a28',
  fallen: '#d9625c',
} as const;

export function draw(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot,
  widthPx: number,
  heightPx: number,
  focusX = 0,
): void {
  const cam = fitCamera(widthPx, heightPx, focusX);

  ctx.fillStyle = COLOURS.bg;
  ctx.fillRect(0, 0, widthPx, heightPx);

  drawGround(ctx, cam, widthPx, heightPx);

  // Far-side limbs first, so the near leg reads in front.
  const order: Snapshot['bodies'][number]['layer'][] = ['far', 'body', 'near'];
  for (const layer of order) {
    for (const b of snap.bodies) {
      if (b.layer !== layer) continue;
      const colour = snap.fallen && layer === 'body' ? COLOURS.fallen : COLOURS[layer];
      const dx = layer === 'far' ? FAR_LEG_RENDER_OFFSET : 0;
      drawBox(ctx, cam, b.x + dx, b.y, b.angle, b.halfWidth, b.halfHeight, colour);
    }
  }

  for (const j of snap.joints) {
    const dx = j.layer === 'far' ? FAR_LEG_RENDER_OFFSET : 0;
    ctx.fillStyle = j.layer === 'far' ? COLOURS.jointFar : COLOURS.joint;
    ctx.beginPath();
    ctx.arc(toScreenX(cam, j.x + dx), toScreenY(cam, j.y), j.layer === 'far' ? 2.5 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGround(ctx: CanvasRenderingContext2D, cam: Camera, widthPx: number, heightPx: number): void {
  const y0 = toScreenY(cam, 0);

  // Metre grid, so the scale of the thing on screen is legible.
  ctx.strokeStyle = COLOURS.grid;
  ctx.lineWidth = 1;
  const firstMetre = Math.floor(cam.cx - widthPx / 2 / cam.scale);
  const lastMetre = Math.ceil(cam.cx + widthPx / 2 / cam.scale);
  for (let m = firstMetre; m <= lastMetre; m++) {
    const x = Math.round(toScreenX(cam, m)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, y0);
    ctx.stroke();
  }
  for (let m = 1; m <= 3; m++) {
    const y = Math.round(toScreenY(cam, m)) + 0.5;
    if (y < 0) break;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(widthPx, y);
    ctx.stroke();
  }

  ctx.strokeStyle = COLOURS.ground;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(y0) + 0.5);
  ctx.lineTo(widthPx, Math.round(y0) + 0.5);
  ctx.stroke();

  // Below-ground hatch, so the floor reads as solid rather than as a line.
  ctx.strokeStyle = COLOURS.tick;
  for (let x = -heightPx; x < widthPx; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, heightPx);
    ctx.lineTo(x + heightPx - y0, y0);
    ctx.stroke();
  }
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  angle: number,
  hw: number,
  hh: number,
  colour: string,
): void {
  ctx.save();
  ctx.translate(toScreenX(cam, x), toScreenY(cam, y));
  // World y is up and canvas y is down, so a positive world rotation is clockwise here.
  ctx.rotate(-angle);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  const w = hw * 2 * cam.scale;
  const h = hh * 2 * cam.scale;
  const r = Math.min(3, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, r);
  ctx.stroke();
  ctx.restore();
}
