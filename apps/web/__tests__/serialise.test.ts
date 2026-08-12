import { describe, expect, it } from 'vitest';
import { archiveInsert, createArchive } from '@evolab/evolution';
import { defaultTitle, runPayload, type RunPayloadInput } from '../src/net/serialise.ts';

function input(over: Partial<RunPayloadInput> = {}): RunPayloadInput {
  return {
    title: 'reference champion',
    seed: 4417, generations: 30, population: 24, trialSeconds: 4, workers: 4,
    goalKey: 'far',
    objective: { distance: 1, upright: 0.5, effort: 0.3, effortBudget: 140 },
    bodySpec: '0.3600,0.1800',
    championGenome: '0.469,0.639',
    championFitness: 6.459812345,
    champion: {
      distance: 5.9598123, uprightTime: 4, effort: 47.03214,
      fell: false, strideLength: 0.92312, dutyFactor: 0.79987,
    },
    archive: null,
    history: [],
    ...over,
  };
}

describe('the run payload', () => {
  it('sends the objective weights, not only the preset key', () => {
    // Presets are copy and copy gets reworded. A stored run must be able to say what it was
    // actually scored on — the same rule as trialSeed in slice 2.
    const body = runPayload(input());
    expect(body['goalKey']).toBe('far');
    expect(body['goalDistance']).toBe(1);
    expect(body['goalUpright']).toBe(0.5);
    expect(body['goalEffort']).toBe(0.3);
    expect(body['goalEffortBudget']).toBe(140);
  });

  it('clamps the naive goal\'s infinite effort budget to something a column can hold', () => {
    // The naive preset uses MAX_SAFE_INTEGER to mean "no budget at all", which is not a
    // number to put in a database.
    const body = runPayload(input({
      goalKey: 'naive',
      objective: { distance: 1, upright: 0, effort: 0, effortBudget: Number.MAX_SAFE_INTEGER },
    }));
    expect(body['goalEffortBudget']).toBe(1e9);
    expect(Number.isSafeInteger(body['goalEffortBudget'] as number)).toBe(true);
  });

  it('rounds, because sixteen figures of a Float32 is noise on a wire', () => {
    const body = runPayload(input());
    expect(body['championFitness']).toBe(6.4598);
    expect(body['championDistance']).toBe(5.9598);
    expect(body['championEffort']).toBe(47);
    expect(body['championDuty']).toBe(0.7999);
  });

  it('survives a champion whose numbers are not finite', () => {
    const body = runPayload(input({
      champion: {
        distance: NaN, uprightTime: 4, effort: Infinity,
        fell: true, strideLength: 0, dutyFactor: 1,
      },
    }));
    // JSON.stringify turns NaN into null and the server would reject it; better to send a
    // number than to lose the whole run over one bad field.
    expect(body['championDistance']).toBe(0);
    expect(body['championEffort']).toBe(0);
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it('sends filled archive cells only', () => {
    // An empty cell is the absence of a behaviour, not a behaviour. Sending 576 nulls would
    // triple the payload to say nothing.
    const archive = createArchive();
    archiveInsert(archive, Float32Array.from([0.1, 0.2]), [0.7, 0.8], 5.5, 3);
    archiveInsert(archive, Float32Array.from([0.3, 0.4]), [0.2, 0.95], 1.25, 7);

    const cells = runPayload(input({ archive }))['archive'] as Array<Record<string, unknown>>;
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => typeof c['index'] === 'number')).toBe(true);
    expect(cells[0]!['genes']).toMatch(/^[\d.,-]+$/);
  });

  it('handles no archive at all', () => {
    expect(runPayload(input({ archive: null }))['archive']).toEqual([]);
  });

  it('copies the chart across', () => {
    const body = runPayload(input({
      history: [
        { generation: 0, best: 1.23456, mean: 0.4, worst: 0, diversity: 0.31 },
        { generation: 1, best: 2.0, mean: 0.9, worst: 0, diversity: 0.29 },
      ],
    }));
    const history = body['history'] as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0]!['best']).toBe(1.2346);
    // `worst` is a chart artefact, not something a stored run needs.
    expect(history[0]!).not.toHaveProperty('worst');
  });

  it('is JSON, all the way down', () => {
    const archive = createArchive();
    archiveInsert(archive, Float32Array.from([0.1]), [0.5, 0.9], 2, 1);
    const body = runPayload(input({ archive, history: [
      { generation: 0, best: 1, mean: 1, worst: 1, diversity: 1 },
    ] }));
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it('trims an over-long title rather than letting the server refuse it', () => {
    expect((runPayload(input({ title: 'x'.repeat(400) }))['title'] as string).length).toBe(120);
  });
});

describe('the default title', () => {
  it('names the goal, the distance and when', () => {
    const title = defaultTitle('Travel as far as you can', 6.1, new Date('2026-08-12T14:02:00Z'));
    expect(title).toBe('Travel as far as you can — 6.1 m — 2026-08-12 14:02');
  });
});
