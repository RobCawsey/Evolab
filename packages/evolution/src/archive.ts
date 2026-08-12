/**
 * A MAP-Elites behaviour archive — specified in §3 of the design document, drawn in Fig 9.5.
 *
 * The genetic algorithm answers one question: what is the best gait? The archive answers a
 * different and, for a teaching tool, better one: *what kinds of gait are there, and how
 * good is the best one of each kind?* It is a grid keyed by behaviour rather than by
 * fitness, and every cell holds the fittest genome that has ever behaved that way.
 *
 * Two axes, both measured rather than declared:
 *
 *   stride length   how far the robot travels per gait cycle
 *   duty factor     what fraction of the time a foot is on the ground
 *
 * Neither appears in `score`. That is the whole point — nothing selects for them, so the
 * spread across the grid is a fact about what the search *found*, not about what it was
 * told to look for. A run that ends with one brilliant cell and 575 empty ones has not
 * explored; a run with 200 filled cells has a repertoire even if its best number is lower.
 * Coverage is the honest measure, and a maximum is a single lucky cell.
 *
 * Pure, like everything else in this package: no timers, no DOM, no randomness. Insertion
 * is deterministic, so an archive is reproducible from a seed exactly as the population is.
 */

import type { Genome } from './controller.ts';
import type { TrialResult } from './fitness.ts';

/** One behavioural dimension: a measured quantity, and how it is divided into bins. */
export interface ArchiveAxis {
  readonly name: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly bins: number;
}

export interface ArchiveCell {
  readonly genes: Genome;
  readonly fitness: number;
  /** The measured behaviour, kept unbinned so a cell can say what it actually did. */
  readonly behaviour: readonly [number, number];
  /** Generation this cell was last claimed or improved. */
  readonly generation: number;
}

export interface Archive {
  /** Columns. */
  readonly stride: ArchiveAxis;
  /** Rows. */
  readonly duty: ArchiveAxis;
  /** Row-major, `duty.bins` rows of `stride.bins`. Null means nothing has behaved that way. */
  readonly cells: (ArchiveCell | null)[];
  /** Cells that are not null. Maintained on insert so coverage is never a scan. */
  filled: number;
  /** Genomes offered to the archive, whether or not they landed anywhere. */
  attempts: number;
  /** Offers that claimed an empty cell or beat the incumbent of a full one. */
  improvements: number;
}

/**
 * The default grid: 24 × 24, matching the population size for no reason other than that a
 * square that size is legible at a glance and blits as one small `ImageData`.
 *
 * Both ranges were set from measurement, not from the textbook. The reference champion
 * (seed 4417, 30 generations, 5.96 m) strides 0.92 m at a duty factor of 0.80, which puts it
 * near the middle of both axes; a much faster run wants headroom above that, hence 1.4 m.
 * The first draft used 0.35 for the lower duty bound on the grounds that 0.5 divides walking
 * from running, and it wasted two thirds of the grid — this morphology never gets airborne.
 *
 * Stride runs from 0, which is not a stride at all but is exactly what a robot that stands
 * still produces and deserves its own column rather than being hidden. Duty stops at 1.0 for
 * the same reason: never lifting a foot is a real, observable, dead-end behaviour, and the
 * top row filling up early with high-scoring statues is one of the more useful things a
 * reader can notice.
 */
export const DEFAULT_STRIDE_AXIS: ArchiveAxis = {
  name: 'stride length', unit: 'm', min: 0, max: 1.4, bins: 24,
};
export const DEFAULT_DUTY_AXIS: ArchiveAxis = {
  name: 'duty factor', unit: '', min: 0.5, max: 1.0, bins: 24,
};

export function createArchive(
  stride: ArchiveAxis = DEFAULT_STRIDE_AXIS,
  duty: ArchiveAxis = DEFAULT_DUTY_AXIS,
): Archive {
  return {
    stride,
    duty,
    cells: new Array<ArchiveCell | null>(stride.bins * duty.bins).fill(null),
    filled: 0,
    attempts: 0,
    improvements: 0,
  };
}

/** Which bin a value falls in. Out-of-range values clamp to the edge rather than vanish. */
export function binOf(axis: ArchiveAxis, value: number): number {
  if (!Number.isFinite(value)) return 0;
  const t = (value - axis.min) / (axis.max - axis.min);
  const i = Math.floor(t * axis.bins);
  return i < 0 ? 0 : i >= axis.bins ? axis.bins - 1 : i;
}

/** Flat index of a behaviour, row-major with duty as the row. */
export function archiveIndex(archive: Archive, behaviour: readonly [number, number]): number {
  const col = binOf(archive.stride, behaviour[0]);
  const row = binOf(archive.duty, behaviour[1]);
  return row * archive.stride.bins + col;
}

/**
 * The behaviour of a trial, or null if it does not have one worth recording.
 *
 * A trial that fell is rejected. This is a judgement about what the map *means* rather than
 * an optimisation: descriptors from a robot that toppled at 0.4 s describe the topple, not a
 * gait, and letting them in fills the corners with noise that no later genome can displace
 * because the incumbent's fitness came mostly from surviving. The map is a repertoire of
 * gaits that hold up for the whole trial, and it starts empty because at generation zero
 * nothing does.
 *
 * The policy lives here, in one named function, so that changing it is one edit and not a
 * hunt through the island.
 */
export function behaviourOf(result: TrialResult): readonly [number, number] | null {
  if (result.fell) return null;
  if (!Number.isFinite(result.strideLength) || !Number.isFinite(result.dutyFactor)) return null;
  return [result.strideLength, result.dutyFactor];
}

/**
 * Offer a genome to the archive. True if it claimed an empty cell or beat the incumbent.
 *
 * Ties lose. Equal fitness in an occupied cell keeps the older genome, which makes the map
 * stable to look at — cells that stop changing have genuinely converged rather than churning
 * between equivalent genomes every generation.
 */
export function archiveInsert(
  archive: Archive,
  genome: Genome,
  behaviour: readonly [number, number],
  fitness: number,
  generation = 0,
): boolean {
  return archivePlace(archive, archiveIndex(archive, behaviour), genome, behaviour, fitness, generation);
}

/**
 * The same offer, into a cell chosen by the caller rather than derived from the behaviour.
 *
 * `archiveInsert` is this with the binning done for you, and it is what almost everything
 * wants. The exception is a cell that has been **stored and read back**: its bin was decided
 * once, from the full-precision behaviour, at the moment it was claimed — and the stride and
 * duty that travel beside it are rounded for display. Re-binning a rounded value can cross a
 * boundary, which is not hypothetical: slice 13 lost a cell to it on the first real run, where
 * a stride of 0.87499 was stored as 0.8750 and re-derived one column to the right, colliding
 * with its neighbour.
 *
 * So the index is authoritative once it exists. The same family of rule as
 * `IslandConfig.trialSeed` — if a decision survives, the conditions it was made under must not
 * change. Kept as one function with `archiveInsert` so the tie-breaking rule cannot be written
 * twice and drift.
 */
export function archivePlace(
  archive: Archive,
  index: number,
  genome: Genome,
  behaviour: readonly [number, number],
  fitness: number,
  generation = 0,
): boolean {
  archive.attempts++;
  if (index < 0 || index >= archive.cells.length) return false;
  const incumbent = archive.cells[index] ?? null;
  if (incumbent !== null && incumbent.fitness >= fitness) return false;

  // Copied. The population mutates its genomes in place between generations, and an archive
  // holding a live reference would silently rewrite its own history.
  archive.cells[index] = {
    genes: Float32Array.from(genome),
    fitness,
    behaviour: [behaviour[0], behaviour[1]],
    generation,
  };
  if (incumbent === null) archive.filled++;
  archive.improvements++;
  return true;
}

/** Fraction of the grid that has ever been reached, 0 to 1. */
export function archiveCoverage(archive: Archive): number {
  return archive.filled / archive.cells.length;
}

/** The fittest cell, or null on an empty archive. Ties keep the earlier index. */
export function archiveBest(archive: Archive): ArchiveCell | null {
  let best: ArchiveCell | null = null;
  for (const cell of archive.cells) {
    if (cell !== null && (best === null || cell.fitness > best.fitness)) best = cell;
  }
  return best;
}

/**
 * Sum of the fitness of every filled cell — the standard MAP-Elites quality-diversity score.
 *
 * Worth watching next to `archiveBest`: they move together while the search is still finding
 * new kinds of gait and come apart once it is only polishing the ones it has.
 */
export function archiveQd(archive: Archive): number {
  let total = 0;
  for (const cell of archive.cells) if (cell !== null) total += cell.fitness;
  return total;
}

/**
 * Fold one archive into another, cell by cell. Returns how many cells improved.
 *
 * This is how four islands become one map on the main thread. It is expressed as repeated
 * insertion rather than as a bulk copy so that the tie-breaking rule can only be written
 * once — a merge that resolved ties differently from an insert would make the displayed map
 * disagree with the workers' maps in a way nobody would ever notice.
 */
export function archiveMerge(target: Archive, source: Archive): number {
  let improved = 0;
  for (const cell of source.cells) {
    if (cell === null) continue;
    if (archiveInsert(target, cell.genes, cell.behaviour, cell.fitness, cell.generation)) {
      improved++;
    }
  }
  return improved;
}
