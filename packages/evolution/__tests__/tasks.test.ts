import { describe, expect, it } from 'vitest';
import { buildBiped, DEFAULT_SPEC } from '../src/morphology.ts';
import {
  badgeOf,
  buildScorecard,
  METRIC_UNITS,
  METRICS,
  scoreTask,
  TASK_SEEDS,
  TASKS,
  taskMorphology,
  type Task,
} from '../src/tasks.ts';
import type { TrialResult } from '../src/fitness.ts';

function trial(over: Partial<TrialResult> = {}): TrialResult {
  return {
    distance: 3, uprightTime: 4, effort: 30, fell: false, duration: 4,
    strideLength: 0.9, dutyFactor: 0.8, ...over,
  };
}

const task = (over: Partial<Task> = {}): Task => ({
  key: 't', name: 'T', teaches: '', seconds: 4, metric: 'distance',
  thresholds: { bronze: 1, silver: 2, gold: 3 }, ...over,
});

describe('the suite as data', () => {
  it('has six tasks, because two of §6 could not be built', () => {
    // Slalom needs a lateral axis the sagittal simulation does not have; Rough needs a
    // segmented ground, which costs more than roughness does. Both cuts are measured and
    // recorded in the slice 14 notes — this test is here so neither quietly comes back.
    expect(TASKS).toHaveLength(6);
    expect(TASKS.map((t) => t.key)).not.toContain('slalom');
    expect(TASKS.map((t) => t.key)).not.toContain('rough');
  });

  it('names a real metric and orders its thresholds', () => {
    for (const t of TASKS) {
      expect(METRICS[t.metric], `${t.key} metric`).toBeTypeOf('function');
      expect(METRIC_UNITS[t.metric], `${t.key} unit`).toBeTypeOf('string');
      // Higher is better everywhere, so this ordering is what makes badgeOf meaningful.
      expect(t.thresholds.bronze, `${t.key} bronze ≤ silver`).toBeLessThanOrEqual(t.thresholds.silver);
      expect(t.thresholds.silver, `${t.key} silver ≤ gold`).toBeLessThanOrEqual(t.thresholds.gold);
    }
  });

  it('has unique keys and an odd number of seeds', () => {
    expect(new Set(TASKS.map((t) => t.key)).size).toBe(TASKS.length);
    // Odd, so the median is a value that actually happened rather than a mean of two.
    expect(TASK_SEEDS.length % 2).toBe(1);
  });

  it('says what each task teaches, because the scorecard is read by a learner', () => {
    for (const t of TASKS) expect(t.teaches.length, t.key).toBeGreaterThan(20);
  });
});

describe('metrics', () => {
  it('makes higher better even for effort', () => {
    // travelPerMetre is negated: a gait that thrashes its way along scores worse than one that
    // glides, and every other metric already reads that way round.
    const thrifty = METRICS.travelPerMetre(trial({ effort: 20, distance: 4 }));
    const wasteful = METRICS.travelPerMetre(trial({ effort: 200, distance: 4 }));
    expect(thrifty).toBeGreaterThan(wasteful);
  });

  it('does not divide by a distance of nearly zero', () => {
    // A robot that fell on the spot has no cost per metre — reporting one would make standing
    // still the most efficient gait in the project.
    expect(METRICS.travelPerMetre(trial({ distance: 0.01, effort: 5 }))).toBe(-1000);
    expect(Number.isFinite(METRICS.travelPerMetre(trial({ distance: 0, effort: 5 })))).toBe(true);
  });

  it('reports speed over the time actually simulated', () => {
    expect(METRICS.meanSpeed(trial({ distance: 6, duration: 4 }))).toBeCloseTo(1.5, 6);
    expect(METRICS.meanSpeed(trial({ duration: 0 }))).toBe(0);
  });
});

describe('badges', () => {
  it('is decided by the thresholds, at the boundary', () => {
    const t = task();
    expect(badgeOf(t, 0.99)).toBe('fail');
    expect(badgeOf(t, 1)).toBe('bronze');
    expect(badgeOf(t, 2)).toBe('silver');
    expect(badgeOf(t, 3)).toBe('gold');
    expect(badgeOf(t, 99)).toBe('gold');
  });

  it('caps at bronze when most trials fell', () => {
    // The rule that earned itself: the reference champion covers 2.37 m on Steps before going
    // down, which clears gold, and the first scorecard printed `5/5 fell` and `GOLD` together.
    const results = [3, 3, 3, 3, 3].map((d, i) => trial({ distance: d, fell: i < 3 }));
    expect(scoreTask(task(), results).badge).toBe('bronze');
  });

  it('does not let one unlucky seed erase a badge', () => {
    const results = [3, 3, 3, 3, 3].map((d, i) => trial({ distance: d, fell: i < 2 }));
    expect(scoreTask(task(), results).badge).toBe('gold');
  });

  it('does not promote a failure to bronze by falling', () => {
    const results = [0, 0, 0, 0, 0].map((d) => trial({ distance: d, fell: true }));
    expect(scoreTask(task(), results).badge).toBe('fail');
  });

  it('scores the median, not the mean, so one lucky run cannot carry it', () => {
    const s = scoreTask(task(), [0, 0, 0, 0, 100].map((d) => trial({ distance: d })));
    expect(s.median).toBe(0);
    expect(s.low).toBe(0);
    expect(s.high).toBe(100);
    expect(s.badge).toBe('fail');
  });
});

describe('the scorecard', () => {
  it('takes the worst badge, so speed cannot buy a gold', () => {
    // §6's rule, and the good one: a minimum in *every* task.
    const card = buildScorecard(new Map([
      ['sprint', [trial({ distance: 99 })]],
      ['payload', [trial({ distance: 0 })]],
    ]));
    expect(card.overall).toBe('fail');
    expect(card.passed).toBe(1);
  });

  it('reports in suite order however the results arrive', () => {
    const card = buildScorecard(new Map([
      ['payload', [trial()]],
      ['sprint', [trial()]],
    ]));
    expect(card.tasks.map((t) => t.task.key)).toEqual(['sprint', 'payload']);
  });

  it('is a fail when there is nothing in it', () => {
    expect(buildScorecard(new Map()).overall).toBe('fail');
  });
});

describe('taskMorphology', () => {
  const morph = buildBiped(DEFAULT_SPEC);

  it('is the identity when a task carries no payload', () => {
    expect(taskMorphology(morph, task())).toBe(morph);
  });

  it('loads the torso and nothing else', () => {
    const heavy = taskMorphology(morph, task({ torsoDensity: 1.25 }));
    const before = new Map(morph.segments.map((s) => [s.id, s.density]));
    for (const s of heavy.segments) {
      const was = before.get(s.id)!;
      expect(s.density, s.id).toBeCloseTo(s.id === 'torso' ? was * 1.25 : was, 9);
    }
    // The original is untouched — a task must not leave the next one a different robot.
    expect(morph.segments.find((s) => s.id === 'torso')!.density).toBe(before.get('torso'));
  });
});
