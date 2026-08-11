import { describe, expect, it } from 'vitest';
import { branchesOf, evaluateCheck, isMetric, metricsIn, placeholdersIn, renderAfterword }
  from '../src/challenges/check.ts';
import { CHALLENGES, challengeById } from '../src/challenges/data.ts';
import { NOTES, noteById } from '../src/challenges/notes.ts';
import { PRESETS } from '../src/run/objectives.ts';
import { OUTCOME_KEYS, type Outcome } from '../src/challenges/types.ts';

function outcome(over: Partial<Outcome> = {}): Outcome {
  const base = Object.fromEntries(OUTCOME_KEYS.map((k) => [k, 1])) as Record<string, number>;
  return { ...base, ...over } as Outcome;
}

describe('the challenge data holds together', () => {
  it('has unique ids', () => {
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    expect(new Set(NOTES.map((n) => n.id)).size).toBe(NOTES.length);
  });

  it('round-trips through JSON', () => {
    // §6 decides tasks are declarative JSON. There is nowhere to fetch them from until slice
    // 12, so they are typed literals for now — this is what keeps that a file move rather
    // than a rewrite. Catches a stray function, Date or undefined the moment one appears.
    expect(JSON.parse(JSON.stringify(CHALLENGES))).toEqual(CHALLENGES);
    expect(JSON.parse(JSON.stringify(NOTES))).toEqual(NOTES);
  });

  it('names only presets that exist', () => {
    const keys = new Set(PRESETS.map((p) => p.key));
    for (const c of CHALLENGES) {
      if (c.setup.goal !== undefined) {
        expect(keys, `${c.id} names goal "${c.setup.goal}"`).toContain(c.setup.goal);
      }
    }
  });

  it('reads only metrics that exist, in checks and in afterwords', () => {
    for (const c of CHALLENGES) {
      for (const m of metricsIn(c.success)) {
        expect(isMetric(m), `${c.id} success reads "${m}"`).toBe(true);
      }
      for (const p of placeholdersIn(c.afterword)) {
        // The one that would otherwise ship: a typo here prints `{championDistnce}` at a
        // learner the first time the card fires, and only then.
        expect(isMetric(p), `${c.id} afterword writes "{${p}}"`).toBe(true);
      }
    }
  });
});

describe('every concept is explained, and every explanation is reached', () => {
  // §7 asks for exactly this, in both directions. It is what stops the explanation layer
  // drifting from the product — the same class of guard as slice 10's palette test.
  it('gives every concept a challenge teaches a note', () => {
    for (const c of CHALLENGES) {
      for (const concept of c.teaches) {
        expect(noteById(concept), `${c.id} teaches "${concept}" with no note`).not.toBeNull();
      }
    }
  });

  it('leaves no note unreachable', () => {
    const taught = new Set(CHALLENGES.flatMap((c) => c.teaches));
    for (const note of NOTES) {
      expect(taught, `note "${note.id}" is not taught by any challenge`).toContain(note.id);
    }
  });

  it('covers the twelve reachable concepts from §7', () => {
    // Three of §7's fifteen are out of reach and the slice 11 notes say why: multi-objective
    // needs a Pareto front, stability margin needs slice 14's terrain, and symmetry is
    // impossible by construction — `gaitTargets` reads `params[joint.kind]`, so both legs
    // share one amplitude and this robot cannot limp. If that ever changes, this number moves.
    expect(new Set(CHALLENGES.flatMap((c) => c.teaches)).size).toBe(12);
  });
});

describe('afterwords survive both outcomes', () => {
  it('renders every branch of every card without leaving a placeholder behind', () => {
    for (const c of CHALLENGES) {
      for (const text of branchesOf(c.afterword)) {
        const rendered = renderAfterword({ text }, outcome());
        expect(rendered, `${c.id} left a placeholder`).not.toMatch(/\{[a-zA-Z]+(:\d)?\}/);
        expect(rendered.length).toBeGreaterThan(20);
      }
    }
  });

  it('says something true whether or not the naive goal misbehaves', () => {
    // The card the whole slice exists for, and the one where fixed copy would do the most
    // damage: evolution does not reliably dive, and asserting a face-plant after a run where
    // the robot plainly walked teaches the reader to stop reading. Slice 6's lesson, retested.
    const card = challengeById('naive-objective')!;

    const dived = renderAfterword(card.afterword, outcome({
      championFell: 1, championUpright: 1.4, championDistance: 3.2, trialSeconds: 4,
    }));
    expect(dived).toContain('1.4 s');
    expect(dived).toContain('The goal is wrong');

    const walked = renderAfterword(card.afterword, outcome({
      championFell: 0, championDistance: 6.5,
    }));
    expect(walked).toContain('6.5 m');
    expect(walked).toContain('luck rather than design');
    // Crucially, the walking branch must not assert a fall.
    expect(walked).not.toMatch(/fell|face|dive/i);
  });

  it('does not claim the fitness line dipped when it did not', () => {
    // Elitism off makes a dip likely, not certain. Asserting one that did not happen is the
    // same failure as asserting a face-plant that did not happen — and the honest branch is
    // better teaching anyway: a guarantee is not the same as having got away with it.
    const card = challengeById('elitism')!;
    expect(renderAfterword(card.afterword, outcome({ bestDips: 3 }))).toContain('went down on 3');
    const held = renderAfterword(card.afterword, outcome({ bestDips: 0 }));
    expect(held).toContain('held up this time');
    expect(held).not.toMatch(/went down/);
  });

  it('does not claim the robot walked when it fell, on the guard-rails card', () => {
    const card = challengeById('guard-rails')!;
    const fell = renderAfterword(card.afterword, outcome({ championFell: 1, championUpright: 2.1 }));
    expect(fell).toContain('still fell');
    expect(fell).toContain('2.1 s');
  });
});

describe('success checks', () => {
  it('are not satisfied by an empty run', () => {
    // Every card must require something to have happened. A check that passes on a fresh
    // page would mark concepts understood that the learner never saw.
    const nothing = outcome(Object.fromEntries(OUTCOME_KEYS.map((k) => [k, 0])) as Partial<Outcome>);
    for (const c of CHALLENGES) {
      expect(evaluateCheck(c.success, nothing), `${c.id} passes on an empty run`).toBe(false);
    }
  });

  it('are satisfied by a good long run', () => {
    const good = outcome({
      generations: 40, championDistance: 6.5, championFitness: 6.46, championFell: 0,
      championDuty: 0.8, championStride: 0.92, archiveCells: 254, coverage: 0.44,
      diversity: 0.11, championUpright: 4, championEffort: 47, trialSeconds: 4,
    });
    for (const c of CHALLENGES) {
      expect(evaluateCheck(c.success, good), `${c.id} fails on a good run`).toBe(true);
    }
  });
});
