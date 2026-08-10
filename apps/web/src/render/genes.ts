/**
 * Gene strips: a genome drawn as n coloured cells.
 *
 * The whole argument for the parametric encoding is that a gene is a thing you can point
 * at (§3 of the design document). This is where that has to be literally true — so the
 * strip is drawn at a size where individual cells are targets, and provenance is a colour
 * rather than a legend.
 */

import type { GeneChange, Genome } from '@evolab/evolution';

export const GENE_COLOURS = {
  /** Unremarkable gene: value mapped to a cool grey ramp. */
  plainLo: [34, 33, 46] as const,
  plainHi: [122, 118, 140] as const,
  parentA: '#8b7bd8',
  parentB: '#4ea8c4',
  mutated: '#e9a13b',
  mutatedRing: '#f0c078',
  blank: '#1b1a24',
} as const;

export type Provenance = 'plain' | 'a' | 'b' | 'mutated';

export interface StripOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Per-gene provenance. Shorter than the genome is fine; the rest draw plain. */
  readonly provenance?: readonly Provenance[];
  /** Gene index under the pointer, drawn with a highlight. */
  readonly hover?: number;
  readonly gap?: number;
}

function plainColour(value: number): string {
  const t = Math.max(0, Math.min(1, value));
  const [r0, g0, b0] = GENE_COLOURS.plainLo;
  const [r1, g1, b1] = GENE_COLOURS.plainHi;
  const r = Math.round(r0 + (r1 - r0) * t);
  const g = Math.round(g0 + (g1 - g0) * t);
  const b = Math.round(b0 + (b1 - b0) * t);
  return `rgb(${r},${g},${b})`;
}

/** Draw one genome. Returns the cell width, so callers can hit-test against it. */
export function drawStrip(
  ctx: CanvasRenderingContext2D,
  genome: Genome,
  opts: StripOptions,
): number {
  const gap = opts.gap ?? 1;
  const n = genome.length;
  const cell = (opts.width - gap * (n - 1)) / n;

  for (let i = 0; i < n; i++) {
    const x = opts.x + i * (cell + gap);
    const kind = opts.provenance?.[i] ?? 'plain';

    ctx.fillStyle =
      kind === 'a' ? GENE_COLOURS.parentA
      : kind === 'b' ? GENE_COLOURS.parentB
      : kind === 'mutated' ? GENE_COLOURS.mutated
      : plainColour(genome[i]!);

    ctx.fillRect(x, opts.y, cell, opts.height);

    // A mutated cell gets a ring as well as a colour: colour alone is doing double duty
    // as both value and provenance elsewhere in the strip.
    if (kind === 'mutated') {
      ctx.strokeStyle = GENE_COLOURS.mutatedRing;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, opts.y + 0.5, cell - 1, opts.height - 1);
    }

    if (opts.hover === i) {
      ctx.strokeStyle = '#e4e2ec';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, opts.y - 1.5, cell + 1, opts.height + 3);
    }
  }
  return cell;
}

/** Which gene index sits under `px`, or -1. Mirror of the layout in `drawStrip`. */
export function geneAt(px: number, opts: Pick<StripOptions, 'x' | 'width' | 'gap'>, length: number): number {
  const gap = opts.gap ?? 1;
  const cell = (opts.width - gap * (length - 1)) / length;
  const i = Math.floor((px - opts.x) / (cell + gap));
  return i >= 0 && i < length ? i : -1;
}

/** Provenance for a child of SBX: blended positions are unremarkable, copies are tinted. */
export function crossoverProvenance(
  blended: readonly boolean[],
  child: 0 | 1,
): Provenance[] {
  return blended.map((wasBlended) => (wasBlended ? 'plain' : child === 0 ? 'a' : 'b'));
}

/** Provenance after mutation: whatever crossover said, overridden where a gene moved. */
export function mutationProvenance(
  base: readonly Provenance[],
  changes: readonly GeneChange[],
  length: number,
): Provenance[] {
  const out: Provenance[] = Array.from({ length }, (_, i) => base[i] ?? 'plain');
  for (const c of changes) out[c.gene] = 'mutated';
  return out;
}
