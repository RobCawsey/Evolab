/**
 * The shared behaviour map, from the browser's side — slice 13.
 *
 * Pure: DTO cells in, an `Archive` out. No `fetch`, no DOM, so it tests in Node like
 * `serialise.ts` and `check.ts`.
 *
 * The result is a **real `Archive`**, not a parallel structure that happens to look like one.
 * That is what lets `drawArchive`, `cellAt` and the click-to-load path work on the community
 * map without knowing it is one — the toggle swaps which archive they are handed and nothing
 * else changes. A second grid type would have meant a second renderer, and then two things that
 * drift.
 */

import {
  archivePlace,
  createArchive,
  GENOME_LENGTH,
  type Archive,
} from '@evolab/evolution';
import type { CommunityCellDto } from './types.ts';

/**
 * One community cell, keyed by grid index — the provenance the `Archive` cannot carry.
 *
 * `Archive` holds genes, fitness and behaviour, which is everything needed to *draw* the map.
 * Who contributed a cell and what body they evolved it on is needed only when one is clicked,
 * so it lives beside the archive rather than being forced into it.
 */
export interface CommunityOrigin {
  readonly runTitle: string;
  readonly bodySpec: string;
}

export interface Community {
  readonly archive: Archive;
  /** Grid index → who it came from. Only indices the archive actually filled. */
  readonly origins: ReadonlyMap<number, CommunityOrigin>;
  /** How many distinct runs are represented in the map on screen. */
  readonly runs: number;
}

/**
 * Parse the comma-separated genes of one cell, or null if they are not a genome.
 *
 * Defensive for the same reason `progress.ts` is: this arrives over a wire from a server that
 * may be older or newer than the code reading it, and one malformed row should cost that row
 * rather than the whole map.
 */
function parseGenes(text: string): Float32Array | null {
  const parts = text.split(',');
  if (parts.length !== GENOME_LENGTH) return null;
  const genes = new Float32Array(GENOME_LENGTH);
  for (let i = 0; i < GENOME_LENGTH; i++) {
    const value = Number(parts[i]);
    if (!Number.isFinite(value)) return null;
    genes[i] = value;
  }
  return genes;
}

/**
 * Fold the server's cells into an archive.
 *
 * The server has already merged — one row per grid index, decided by the same rule
 * `archiveInsert` uses — so this is not a second merge and cannot disagree with one. It is
 * still expressed as an offer rather than as direct assignment, because that way a duplicate
 * index in a response resolves under the project's one rule instead of by arrival order.
 *
 * **`archivePlace`, not `archiveInsert`: the stored index is authoritative.** Re-deriving the
 * bin from the stride and duty that travel beside the cell looks equivalent and is not — those
 * are rounded to four decimals for the wire, and a rounded value can land one bin over. The
 * first real run of this code did exactly that: 244 cells arrived and 243 appeared, because a
 * stride of 0.87499 was stored as 0.8750 and re-binned on top of its neighbour.
 */
export function buildCommunity(
  cells: readonly CommunityCellDto[],
  runs: number,
): Community {
  const archive = createArchive();
  const origins = new Map<number, CommunityOrigin>();

  for (const cell of cells) {
    const genes = parseGenes(cell.genes);
    if (genes === null) continue;
    if (archivePlace(archive, cell.index, genes, [cell.stride, cell.duty], cell.fitness)) {
      origins.set(cell.index, { runTitle: cell.runTitle, bodySpec: cell.bodySpec });
    }
  }

  return { archive, origins, runs };
}

/**
 * Which cells of `theirs` your own run also fills.
 *
 * This is the whole comparison the slice exists for, and it needs no provenance at all — it is
 * computed from the two archives the browser already has. Outlining these on the shared map
 * answers "where does my run sit in the space everyone has explored", which is the
 * quality–diversity lesson with somebody else's data as the control.
 */
export function overlapOf(mine: Archive | null, theirs: Archive): ReadonlySet<number> {
  const shared = new Set<number>();
  if (mine === null) return shared;
  // Same grid by construction — both come from `createArchive()` with the default axes — but
  // an archive with different bins would silently compare the wrong cells, so it is checked.
  if (mine.cells.length !== theirs.cells.length) return shared;
  for (let i = 0; i < theirs.cells.length; i++) {
    if (theirs.cells[i] && mine.cells[i]) shared.add(i);
  }
  return shared;
}
