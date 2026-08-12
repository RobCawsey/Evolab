import { describe, expect, it } from 'vitest';
import { buildScorecard, TASKS, type TrialResult } from '@evolab/evolution';
import { formatValue, verdictOf } from '../src/ui/scorecard.ts';

function trial(over: Partial<TrialResult> = {}): TrialResult {
  return {
    distance: 3, uprightTime: 4, effort: 30, fell: false, duration: 4,
    strideLength: 0.9, dutyFactor: 0.8, ...over,
  };
}

const card = (byTask: Record<string, TrialResult[]>) =>
  buildScorecard(new Map(Object.entries(byTask)));

const five = (over: Partial<TrialResult> = {}) => [1, 2, 3, 4, 5].map(() => trial(over));

describe('formatValue', () => {
  it('shows effort per metre as a cost, not as a negated score', () => {
    // travelPerMetre is stored negated so that higher is better everywhere. The reader wants
    // the radians the robot actually spent, so it flips back for display only.
    const c = card({ endurance: five({ effort: 40, distance: 4 }) });
    expect(formatValue(c.tasks[0]!)).toBe('10.00 rad/m');
  });

  it('carries each task’s own unit', () => {
    const c = card({ sprint: five({ distance: 6, duration: 4 }) });
    expect(formatValue(c.tasks[0]!)).toBe('1.50 m/s');
  });
});

describe('verdictOf', () => {
  it('names the task holding the badge down, not just the badge', () => {
    // The actionable half of §6's minimum-in-every-task rule: "bronze" teaches nothing,
    // "bronze because it falls on the steps" says what to fix.
    const c = card({
      sprint: five({ distance: 8, duration: 4 }),
      steps: five({ distance: 2.3, fell: true }),
    });
    expect(c.overall).toBe('bronze');
    expect(verdictOf(c)).toContain('Steps');
    expect(verdictOf(c)).toContain('5 of 5');
  });

  it('quotes the score when the task did not fall', () => {
    const c = card({
      sprint: five({ distance: 8, duration: 4 }),
      payload: five({ distance: 1.0 }),
    });
    expect(verdictOf(c)).toContain('Payload');
    expect(verdictOf(c)).toContain('1.00 m');
  });

  it('says so plainly when everything is cleared', () => {
    const c = card({ sprint: five({ distance: 8, duration: 4 }) });
    expect(c.overall).toBe('gold');
    expect(verdictOf(c)).toContain('every task cleared');
  });

  it('is empty rather than wrong when there is no card', () => {
    expect(verdictOf(buildScorecard(new Map()))).toBe('');
  });

  it('always explains the composite rule', () => {
    const c = card({
      sprint: five({ distance: 8, duration: 4 }),
      payload: five({ distance: 0 }),
    });
    expect(verdictOf(c)).toContain('worst task');
  });
});

describe('the panel and the suite agree', () => {
  it('formats every task in the real suite without throwing', () => {
    // Guards the display path against a task being added with a metric the panel cannot show.
    const c = buildScorecard(new Map(TASKS.map((t) => [t.key, five()])));
    expect(c.tasks).toHaveLength(TASKS.length);
    for (const score of c.tasks) {
      expect(formatValue(score), score.task.key).toMatch(/^-?\d+\.\d\d /);
    }
  });
});
