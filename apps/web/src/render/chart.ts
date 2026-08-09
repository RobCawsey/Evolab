/**
 * The fitness chart. Hand-rolled canvas, no charting library.
 *
 * A few hundred points and three series does not need uPlot, and drawing it by hand keeps
 * the axes honest — every decision about what the reader sees is visible in this file.
 */

import type { GenerationSummary } from '@evolab/evolution';

const COLOURS = {
  grid: '#1f1e2b',
  axis: '#2c2a3a',
  best: '#e9a13b',
  mean: '#4ea8c4',
  band: 'rgba(78, 168, 196, 0.14)',
  diversity: '#8b7bd8',
  label: '#5c5871',
  text: '#8c8899',
} as const;

const PAD = { left: 38, right: 12, top: 12, bottom: 20 };

export interface ChartOptions {
  /** Draw the diversity series on its own 0..max scale. */
  readonly showDiversity?: boolean;
  /** Generations the run is aiming for, so the x-axis does not rescale every frame. */
  readonly targetGenerations?: number;
}

export function drawChart(
  ctx: CanvasRenderingContext2D,
  history: readonly GenerationSummary[],
  width: number,
  height: number,
  opts: ChartOptions = {},
): void {
  ctx.clearRect(0, 0, width, height);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  if (plotW < 20 || plotH < 20) return;

  // A fixed x-extent means the curve grows into the space rather than the whole plot
  // rescaling under the reader every frame, which makes progress much harder to judge.
  const maxGen = Math.max(opts.targetGenerations ?? 1, history.length, 1);
  const maxFitness = Math.max(1, ...history.map((h) => h.best)) * 1.1;

  const x = (gen: number) => PAD.left + (gen / Math.max(1, maxGen - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / maxFitness) * plotH;

  // --- grid and axes ------------------------------------------------------------
  ctx.strokeStyle = COLOURS.grid;
  ctx.lineWidth = 1;
  ctx.font = '10px "Cascadia Mono", Consolas, monospace';
  ctx.fillStyle = COLOURS.label;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const value = (maxFitness / 4) * i;
    const py = Math.round(y(value)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.left, py);
    ctx.lineTo(PAD.left + plotW, py);
    ctx.stroke();
    ctx.fillText(value.toFixed(1), PAD.left - 6, py);
  }

  ctx.strokeStyle = COLOURS.axis;
  ctx.beginPath();
  ctx.moveTo(PAD.left + 0.5, PAD.top);
  ctx.lineTo(PAD.left + 0.5, PAD.top + plotH + 0.5);
  ctx.lineTo(PAD.left + plotW, PAD.top + plotH + 0.5);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('0', PAD.left, PAD.top + plotH + 5);
  ctx.fillText(String(maxGen), PAD.left + plotW, PAD.top + plotH + 5);
  ctx.fillText('generation', PAD.left + plotW / 2, PAD.top + plotH + 5);

  if (history.length === 0) {
    ctx.fillStyle = COLOURS.label;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('press run', PAD.left + plotW / 2, PAD.top + plotH / 2);
    return;
  }

  // --- spread band --------------------------------------------------------------
  // Worst-to-mean rather than a true inter-quartile range: the summary carries best, mean
  // and worst, and adding quartiles would mean keeping every individual's fitness for
  // every generation. The band still shows the population spreading and collapsing.
  ctx.fillStyle = COLOURS.band;
  ctx.beginPath();
  history.forEach((h, i) => (i === 0 ? ctx.moveTo(x(i), y(h.mean)) : ctx.lineTo(x(i), y(h.mean))));
  for (let i = history.length - 1; i >= 0; i--) ctx.lineTo(x(i), y(history[i]!.worst));
  ctx.closePath();
  ctx.fill();

  // --- diversity, on its own scale ----------------------------------------------
  if (opts.showDiversity) {
    const maxDiv = Math.max(0.001, ...history.map((h) => h.diversity));
    ctx.strokeStyle = COLOURS.diversity;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    history.forEach((h, i) => {
      const py = PAD.top + plotH - (h.diversity / maxDiv) * plotH;
      return i === 0 ? ctx.moveTo(x(i), py) : ctx.lineTo(x(i), py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  line(ctx, history, x, y, (h) => h.mean, COLOURS.mean, 1.4);
  line(ctx, history, x, y, (h) => h.best, COLOURS.best, 2);

  // --- current best marker ------------------------------------------------------
  const last = history[history.length - 1]!;
  const lx = x(history.length - 1);
  const ly = y(last.best);
  ctx.fillStyle = COLOURS.best;
  ctx.beginPath();
  ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLOURS.best;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.arc(lx, ly, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function line(
  ctx: CanvasRenderingContext2D,
  history: readonly GenerationSummary[],
  x: (g: number) => number,
  y: (v: number) => number,
  pick: (h: GenerationSummary) => number,
  colour: string,
  width: number,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  history.forEach((h, i) => (i === 0 ? ctx.moveTo(x(i), y(pick(h))) : ctx.lineTo(x(i), y(pick(h)))));
  ctx.stroke();
}
