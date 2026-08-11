/**
 * The behaviour map — Fig 11.1. One `ImageData` blit, not 576 DOM nodes.
 *
 * It repaints on every generation, and at four workers that is several times a second. A
 * grid of divs at that rate spends more time in style recalculation than the search spends
 * evolving, which would be a memorable way to make the slice that visualises the search the
 * thing that slows it down.
 *
 * The cells are drawn into a 24 × 24 `ImageData` at one device pixel per cell and then
 * scaled up with smoothing off, so the whole repaint is one `putImageData` into an offscreen
 * canvas and one `drawImage`. Axes and labels are drawn over the top in the usual way, since
 * they change only when the canvas resizes.
 */

import { archiveBest, type Archive, type ArchiveCell } from '@evolab/evolution';

const COLOURS = {
  empty: '#151420',
  grid: '#23212f',
  axis: '#2c2a3a',
  label: '#5c5871',
  text: '#8c8899',
  hi: '#e9a13b',
} as const;

const PAD = { left: 34, right: 10, top: 10, bottom: 26 };

/**
 * Cell colour by fitness, relative to the best cell in the map.
 *
 * Relative rather than absolute on purpose: early on the whole map is dim and the reader
 * cannot tell a filled cell from an empty one, which is exactly the moment the map has the
 * most to say. Normalising means the map always shows its own shape. The consequence — that
 * colour is not comparable between two screenshots taken at different times — is why the
 * best cell's actual fitness is printed underneath.
 */
function cellColour(fitness: number, best: number): [number, number, number] {
  const t = best > 0 ? Math.max(0, Math.min(1, fitness / best)) : 0;
  // Deep indigo → cyan → amber. Two linear segments; a real colour ramp is not worth the
  // code, and this one is monotone in luminance, which is what makes it readable.
  if (t < 0.5) {
    const u = t / 0.5;
    return [Math.round(40 + u * 38), Math.round(38 + u * 130), Math.round(90 + u * 106)];
  }
  const u = (t - 0.5) / 0.5;
  return [Math.round(78 + u * 155), Math.round(168 - u * 7), Math.round(196 - u * 137)];
}

export interface ArchiveHit {
  readonly index: number;
  readonly cell: ArchiveCell;
}

export interface ArchiveView {
  /** Pixel rect of the grid itself, for hit-testing a pointer. */
  readonly plot: { x: number; y: number; w: number; h: number };
}

let scratch: HTMLCanvasElement | null = null;

/** Draw the map. Returns where the grid landed, so a click can be turned back into a cell. */
export function drawArchive(
  ctx: CanvasRenderingContext2D,
  archive: Archive,
  width: number,
  height: number,
  highlight: number | null = null,
): ArchiveView {
  const cols = archive.stride.bins;
  const rows = archive.duty.bins;

  ctx.clearRect(0, 0, width, height);

  // Keep the grid square: a 24 × 24 map drawn as a rectangle makes stride and duty look
  // like they have different resolutions, and they do not.
  const availW = width - PAD.left - PAD.right;
  const availH = height - PAD.top - PAD.bottom;
  const size = Math.max(24, Math.min(availW, availH));
  const plot = { x: PAD.left + (availW - size) / 2, y: PAD.top, w: size, h: size };

  const best = archiveBest(archive);
  const peak = best?.fitness ?? 0;

  // --- the cells, as one image ---
  const image = ctx.createImageData(cols, rows);
  const px = image.data;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = archive.cells[row * cols + col] ?? null;
      // Row 0 of the image is the top of the screen, and duty bin 0 is the bottom of the
      // axis. The map is flipped here so that "more airborne" reads as lower, like a graph.
      const o = ((rows - 1 - row) * cols + col) * 4;
      if (cell === null) {
        px[o] = 0x15; px[o + 1] = 0x14; px[o + 2] = 0x20; px[o + 3] = 255;
      } else {
        const [r, g, b] = cellColour(cell.fitness, peak);
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
  }

  if (!scratch) scratch = document.createElement('canvas');
  scratch.width = cols;
  scratch.height = rows;
  const sctx = scratch.getContext('2d');
  if (!sctx) return { plot };
  sctx.putImageData(image, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, plot.x, plot.y, plot.w, plot.h);
  ctx.imageSmoothingEnabled = true;

  // --- grid lines every four cells, so a cell can be counted off an axis ---
  const cw = plot.w / cols;
  const ch = plot.h / rows;
  ctx.strokeStyle = COLOURS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= cols; c += 4) {
    const x = Math.round(plot.x + c * cw) + 0.5;
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
  }
  for (let r = 0; r <= rows; r += 4) {
    const y = Math.round(plot.y + r * ch) + 0.5;
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
  }
  ctx.stroke();

  // --- the champion's cell, ringed ---
  if (best !== null) {
    const index = archive.cells.indexOf(best);
    ringCell(ctx, plot, cols, rows, index, COLOURS.hi, 2);
  }
  if (highlight !== null && archive.cells[highlight]) {
    ringCell(ctx, plot, cols, rows, highlight, '#ffffff', 1.5);
  }

  // --- axes ---
  ctx.strokeStyle = COLOURS.axis;
  ctx.strokeRect(Math.round(plot.x) + 0.5, Math.round(plot.y) + 0.5, plot.w, plot.h);

  ctx.fillStyle = COLOURS.label;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(archive.stride.min.toFixed(1), plot.x, plot.y + plot.h + 12);
  ctx.fillText(archive.stride.max.toFixed(1), plot.x + plot.w, plot.y + plot.h + 12);
  ctx.fillStyle = COLOURS.text;
  ctx.fillText('stride length, m', plot.x + plot.w / 2, plot.y + plot.h + 22);

  ctx.save();
  ctx.translate(plot.x - 22, plot.y + plot.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = COLOURS.text;
  ctx.fillText('duty factor', 0, 0);
  ctx.restore();

  ctx.fillStyle = COLOURS.label;
  ctx.textAlign = 'right';
  ctx.fillText(archive.duty.max.toFixed(2), plot.x - 4, plot.y + 8);
  ctx.fillText(archive.duty.min.toFixed(2), plot.x - 4, plot.y + plot.h);

  return { plot };
}

function ringCell(
  ctx: CanvasRenderingContext2D,
  plot: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number,
  index: number,
  colour: string,
  lineWidth: number,
): void {
  const col = index % cols;
  const row = (index / cols) | 0;
  const cw = plot.w / cols;
  const ch = plot.h / rows;
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(
    plot.x + col * cw - 1,
    plot.y + (rows - 1 - row) * ch - 1,
    cw + 2,
    ch + 2,
  );
  ctx.lineWidth = 1;
}

/** Turn a pointer position into a cell, or null if it is outside the grid or empty. */
export function cellAt(
  archive: Archive,
  view: ArchiveView,
  x: number,
  y: number,
): ArchiveHit | null {
  const { plot } = view;
  if (x < plot.x || x >= plot.x + plot.w || y < plot.y || y >= plot.y + plot.h) return null;
  const cols = archive.stride.bins;
  const rows = archive.duty.bins;
  const col = Math.min(cols - 1, Math.floor(((x - plot.x) / plot.w) * cols));
  const row = rows - 1 - Math.min(rows - 1, Math.floor(((y - plot.y) / plot.h) * rows));
  const index = row * cols + col;
  const cell = archive.cells[index] ?? null;
  return cell === null ? null : { index, cell };
}
