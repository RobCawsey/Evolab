/**
 * The shape of a challenge — §7's concept ladder expressed as data.
 *
 * **Defined in TypeScript, shaped as JSON.** §6 of the design document decides that tasks are
 * declarative JSON so they can ship without a release, which is true and has no customer
 * until there is a server to fetch them from (slice 12). Writing them as typed literals now
 * buys compile-time checking of every concept id and preset key for free, and a test asserts
 * the whole set round-trips through `JSON.stringify` — so moving to a fetch later is a file
 * move rather than a rewrite. No functions, no `Date`, no `undefined`.
 */

import type { IslandConfig } from '@evolab/evolution';

/**
 * Everything a challenge can test against or quote back.
 *
 * **Every field is a number, including the booleans.** `championFell` is 0 or 1 rather than
 * `false` or `true`, which means `Check` needs exactly one comparison shape instead of a
 * numeric one and a boolean one. The cost is a slightly odd-looking `championFell == 1` in
 * the data; the gain is that the evaluator is fifteen lines and cannot grow a second code
 * path.
 *
 * The keys are listed as a runtime array and the type is derived from it, so a test can check
 * that every placeholder a card writes actually names a field. A type alone could not.
 */
export const OUTCOME_KEYS = [
  'championDistance',
  'championFitness',
  'championUpright',
  'championEffort',
  'championStride',
  'championDuty',
  /** 0 or 1 — see above. */
  'championFell',
  /** Best of generation 0, for the before-and-after cards. */
  'firstDistance',
  'firstFitness',
  'generations',
  'diversity',
  /**
   * How many times the best-fitness line fell between samples.
   *
   * Zero for every normal run — elitism makes it impossible. It exists so the elitism card
   * can check that the thing it claims happened actually happened, rather than asserting it.
   */
  'bestDips',
  /** Fraction of the behaviour archive filled, 0–1. */
  'coverage',
  'archiveCells',
  'trialSeconds',
  'population',
] as const;

export type Metric = (typeof OUTCOME_KEYS)[number];
export type Outcome = { readonly [K in Metric]: number };

export type Op = '>=' | '<=' | '>' | '<' | '==' | '!=';

export type Check =
  | { readonly metric: Metric; readonly op: Op; readonly value: number }
  | { readonly all: readonly Check[] }
  | { readonly any: readonly Check[] }
  | { readonly not: Check };

/**
 * Copy shown *after* a run, branching on what actually happened.
 *
 * Slice 6 learned this the hard way and it is the reason this type is not a string: copy
 * asserting that the robot face-planted, shown after a run where it plainly walked, teaches
 * the reader to stop reading the copy. Presets solved it by making the afterword a function
 * of the outcome. Challenges are data and cannot hold functions, so the branch moves into the
 * format.
 */
export type Afterword =
  | { readonly text: string }
  | { readonly when: Check; readonly then: Afterword; readonly otherwise: Afterword };

/** Which panel a card wants in front of the learner when it opens. */
export type Focus = 'stepper' | 'archive' | 'gait' | '3d' | 'chart';

export interface ChallengeSetup {
  /**
   * **Deliberately not `'guided'`.**
   *
   * The guided stage hides everything marked `.explorer-only`, which is Run, Reset, the mode
   * toggle, the behaviour map and the gait strip. A card that selected it left the learner
   * reading "Run 30 generations" with no Run button on screen — and with the track open the
   * guided flow's own start button is hidden too, so there was no way to start anything at
   * all. The track is the Explorer-level curriculum; the guided flow is a different first-run
   * path that does not need it.
   *
   * Excluded from the type rather than caught by a test, because a card that cannot ask for
   * it cannot regress.
   */
  readonly stage?: 'explorer' | 'lab';
  /** Preset key from `run/objectives.ts`. */
  readonly goal?: string;
  readonly gens?: number;
  readonly seed?: number;
  /** GA knobs. Only the ones `spawnPool` threads through are honoured. */
  readonly config?: Pick<Partial<IslandConfig>, 'elites' | 'mutationRate' | 'tournamentSize'>;
  readonly focus?: Focus;
}

export interface Challenge {
  readonly id: string;
  readonly title: string;
  /** Concept ids. Every one must have a note in `notes.ts` — asserted by a test. */
  readonly teaches: readonly string[];
  /** One or two sentences, shown before the card is attempted. Never gives the answer away. */
  readonly brief: string;
  /** What to do, in the imperative. */
  readonly task: string;
  readonly setup: ChallengeSetup;
  /** Holds when the card is complete. Read from the outcome, never from the DOM. */
  readonly success: Check;
  readonly afterword: Afterword;
}

export interface ConceptNote {
  readonly id: string;
  readonly name: string;
  /** Plain language, and short. The `?` control opens this in the right rail. */
  readonly text: string;
}
