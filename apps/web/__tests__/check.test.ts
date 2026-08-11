import { describe, expect, it } from 'vitest';
import {
  branchesOf, evaluateCheck, interpolate, isMetric, metricsIn, placeholdersIn, renderAfterword,
} from '../src/challenges/check.ts';
import { OUTCOME_KEYS, type Afterword, type Check, type Outcome } from '../src/challenges/types.ts';

function outcome(over: Partial<Outcome> = {}): Outcome {
  const base = Object.fromEntries(OUTCOME_KEYS.map((k) => [k, 0])) as Record<string, number>;
  return { ...base, ...over } as Outcome;
}

describe('checks', () => {
  it('compares a metric against a value', () => {
    const o = outcome({ championDistance: 6.4 });
    expect(evaluateCheck({ metric: 'championDistance', op: '>=', value: 5 }, o)).toBe(true);
    expect(evaluateCheck({ metric: 'championDistance', op: '>=', value: 7 }, o)).toBe(false);
    expect(evaluateCheck({ metric: 'championDistance', op: '<', value: 7 }, o)).toBe(true);
  });

  it('treats booleans as numbers so there is only one comparison shape', () => {
    // championFell is 0 or 1. The odd-looking `== 1` in the data is the price of the
    // evaluator having no second code path for booleans.
    expect(evaluateCheck({ metric: 'championFell', op: '==', value: 1 }, outcome({ championFell: 1 }))).toBe(true);
    expect(evaluateCheck({ metric: 'championFell', op: '==', value: 1 }, outcome({ championFell: 0 }))).toBe(false);
  });

  it('compares equality with a tolerance, not exactly', () => {
    // Every metric is a float that has been through a Float32Array and back.
    const nearly = outcome({ championFell: 1 - 1e-12 });
    expect(evaluateCheck({ metric: 'championFell', op: '==', value: 1 }, nearly)).toBe(true);
  });

  it('combines with all, any and not', () => {
    const o = outcome({ championDistance: 6, championFell: 0 });
    const walked: Check = {
      all: [
        { metric: 'championDistance', op: '>=', value: 5 },
        { metric: 'championFell', op: '==', value: 0 },
      ],
    };
    expect(evaluateCheck(walked, o)).toBe(true);
    expect(evaluateCheck({ not: walked }, o)).toBe(false);
    expect(evaluateCheck({ any: [walked, { metric: 'championDistance', op: '>', value: 99 }] }, o)).toBe(true);
    expect(evaluateCheck({ all: [walked, { metric: 'championDistance', op: '>', value: 99 }] }, o)).toBe(false);
  });

  it('reports every metric it reads, at any depth', () => {
    const nested: Check = {
      all: [
        { metric: 'championDistance', op: '>=', value: 1 },
        { any: [{ not: { metric: 'diversity', op: '<', value: 0.1 } }] },
      ],
    };
    expect(metricsIn(nested).sort()).toEqual(['championDistance', 'diversity']);
  });
});

describe('interpolation', () => {
  it('writes a metric with a sensible default precision', () => {
    const o = outcome({ championDistance: 6.4598, generations: 30 });
    expect(interpolate('{championDistance} m in {generations} generations', o))
      .toBe('6.5 m in 30 generations');
  });

  it('honours an explicit decimal count', () => {
    expect(interpolate('{championDistance:3}', outcome({ championDistance: 6.4598 })))
      .toBe('6.460');
  });

  it('writes coverage as a percentage, because that is how it is read', () => {
    // The one metric whose stored form and written form differ.
    expect(interpolate('{coverage}', outcome({ coverage: 0.441 }))).toBe('44%');
  });

  it('leaves an unknown placeholder verbatim rather than printing undefined', () => {
    // A test asserts no card contains one, so this only shows up while authoring — and
    // seeing the misspelling in the panel beats seeing NaN.
    expect(interpolate('{championDistnce} m', outcome())).toBe('{championDistnce} m');
  });

  it('leaves text with no placeholders alone', () => {
    expect(interpolate('nothing to see', outcome())).toBe('nothing to see');
  });

  it('knows which names are metrics', () => {
    expect(isMetric('championDistance')).toBe(true);
    expect(isMetric('championDistnce')).toBe(false);
  });
});

describe('afterwords', () => {
  // The format exists for exactly this: slice 6 found that copy asserting a face-plant, shown
  // after a run where the robot plainly walked, teaches the reader to stop reading.
  const diving: Afterword = {
    when: { metric: 'championFell', op: '==', value: 1 },
    then: { text: 'It fell after {championUpright} s and still scored best.' },
    otherwise: { text: 'It walked {championDistance} m, which is luck rather than design.' },
  };

  it('takes the branch the outcome selects', () => {
    expect(renderAfterword(diving, outcome({ championFell: 1, championUpright: 1.24 })))
      .toBe('It fell after 1.2 s and still scored best.');
    expect(renderAfterword(diving, outcome({ championFell: 0, championDistance: 6.4 })))
      .toBe('It walked 6.4 m, which is luck rather than design.');
  });

  it('nests', () => {
    const nested: Afterword = {
      when: { metric: 'championFell', op: '==', value: 1 },
      then: diving,
      otherwise: { text: 'upright' },
    };
    expect(renderAfterword(nested, outcome({ championFell: 1, championUpright: 2 })))
      .toBe('It fell after 2.0 s and still scored best.');
  });

  it('exposes every branch and every placeholder for the data tests', () => {
    expect(branchesOf(diving)).toHaveLength(2);
    expect(placeholdersIn(diving).sort())
      .toEqual(['championDistance', 'championFell', 'championUpright']);
  });
});
