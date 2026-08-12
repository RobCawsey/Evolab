import { describe, expect, it } from 'vitest';
import { archiveInsert, createArchive, GENOME_LENGTH } from '@evolab/evolution';
import { buildCommunity, overlapOf } from '../src/net/community.ts';
import type { CommunityCellDto } from '../src/net/types.ts';

const genes = (seed = 0.5): string =>
  Array.from({ length: GENOME_LENGTH }, (_, i) => (seed + i * 0.01).toFixed(4)).join(',');

function cell(over: Partial<CommunityCellDto> = {}): CommunityCellDto {
  return {
    index: 0,
    fitness: 6.4598,
    stride: 0.923,
    duty: 0.8,
    genes: genes(),
    runTitle: 'reference champion',
    bodySpec: '0.3600,0.1800',
    ...over,
  };
}

describe('buildCommunity', () => {
  it('produces a real Archive, so the renderer needs no special case', () => {
    const community = buildCommunity([cell(), cell({ index: 40, stride: 0.2, duty: 0.6 })], 2);

    expect(community.archive.filled).toBe(2);
    expect(community.archive.cells).toHaveLength(576);
    expect(community.runs).toBe(2);
  });

  it('carries the genes through as a genome the sliders can decode', () => {
    const community = buildCommunity([cell({ genes: genes(0.25) })], 1);
    const only = community.archive.cells.find((c) => c !== null);

    expect(only).not.toBeNull();
    expect(only!.genes).toHaveLength(GENOME_LENGTH);
    expect(only!.genes[0]).toBeCloseTo(0.25, 4);
    expect(only!.genes[10]).toBeCloseTo(0.35, 4);
  });

  it('puts a cell where the server says, not where the rounded behaviour re-bins to', () => {
    // The regression guard, and it cost a cell to find. `serialise.ts` rounds stride and duty
    // to four decimals for the wire; the bin was decided once, from the full-precision value,
    // when the cell was claimed. A stride of 0.87499 stored as 0.8750 re-derives one column to
    // the right — the first real run sent 244 cells and drew 243.
    const community = buildCommunity(
      [
        cell({ index: 326, stride: 0.875, duty: 0.7789, fitness: 3, runTitle: 'left' }),
        cell({ index: 327, stride: 0.9125, duty: 0.7804, fitness: 4, runTitle: 'right' }),
      ],
      1,
    );

    expect(community.archive.filled).toBe(2);
    expect(community.archive.cells[326]!.fitness).toBe(3);
    expect(community.archive.cells[327]!.fitness).toBe(4);
    expect(community.origins.get(326)!.runTitle).toBe('left');
    expect(community.origins.get(327)!.runTitle).toBe('right');
  });

  it('carries the origin so a clicked cell can name the body it was evolved on', () => {
    const community = buildCommunity(
      [cell({ index: 300, runTitle: 'theirs', bodySpec: 'long legs' })],
      1,
    );
    expect(community.origins.get(300)).toEqual({ runTitle: 'theirs', bodySpec: 'long legs' });
  });

  it('drops a cell whose index is off the grid rather than throwing', () => {
    const community = buildCommunity([cell({ index: 999 }), cell({ index: -1 })], 1);
    expect(community.archive.filled).toBe(0);
    expect(community.origins.size).toBe(0);
  });

  it('skips a malformed row rather than losing the map', () => {
    // This arrives over a wire from a server that may be older or newer than the code reading
    // it. One bad row costs that row — the same rule progress.ts follows for localStorage.
    const community = buildCommunity(
      [
        cell({ index: 10, genes: 'not,a,genome' }),
        cell({ index: 11, genes: '1,2,3' }),
        cell({ index: 12, genes: genes() }),
        cell({ index: 13, genes: genes().replace('0.5000', 'NaN') }),
      ],
      1,
    );

    expect(community.archive.filled).toBe(1);
  });

  it('resolves a duplicate index under the same rule as everything else', () => {
    // The server sends one row per index, so this should not happen — but if it ever does,
    // higher fitness wins and ties keep the incumbent, exactly as archiveInsert says.
    const community = buildCommunity(
      [
        cell({ fitness: 4, runTitle: 'first' }),
        cell({ fitness: 4, runTitle: 'tie — must lose' }),
        cell({ fitness: 9, runTitle: 'winner' }),
      ],
      1,
    );

    const landed = community.archive.cells.findIndex((c) => c !== null);
    expect(community.archive.filled).toBe(1);
    expect(community.archive.cells[landed]!.fitness).toBe(9);
    expect(community.origins.get(landed)!.runTitle).toBe('winner');
  });

  it('is empty and harmless when nobody has published anything', () => {
    const community = buildCommunity([], 0);
    expect(community.archive.filled).toBe(0);
    expect(community.origins.size).toBe(0);
    expect(community.runs).toBe(0);
  });
});

describe('overlapOf', () => {
  const fill = (indices: readonly number[]) => {
    const archive = createArchive();
    for (const i of indices) {
      // Place a genome directly in the cell, since the point here is the index set.
      archive.cells[i] = {
        genes: new Float32Array(GENOME_LENGTH),
        fitness: 1,
        behaviour: [0, 0],
        generation: 0,
      };
      archive.filled++;
    }
    return archive;
  };

  it('is the intersection of the two maps', () => {
    expect([...overlapOf(fill([1, 2, 3]), fill([2, 3, 4]))].sort((a, b) => a - b))
      .toEqual([2, 3]);
  });

  it('is empty before anything has evolved', () => {
    expect(overlapOf(null, fill([1, 2])).size).toBe(0);
    expect(overlapOf(createArchive(), fill([1, 2])).size).toBe(0);
  });

  it('refuses to compare grids of different sizes', () => {
    // Both archives come from createArchive() today, so this can only happen if the axes
    // change — and comparing cell 40 of a 24×24 grid with cell 40 of a 32×32 one would report
    // an overlap between two unrelated behaviours.
    const mine = createArchive();
    const theirs = createArchive(
      { name: 'stride length', unit: 'm', min: 0, max: 1.4, bins: 32 },
      { name: 'duty factor', unit: '', min: 0.5, max: 1, bins: 32 },
    );
    archiveInsert(mine, new Float32Array(GENOME_LENGTH), [0.9, 0.8], 1);
    archiveInsert(theirs, new Float32Array(GENOME_LENGTH), [0.9, 0.8], 1);

    expect(overlapOf(mine, theirs).size).toBe(0);
  });
});
