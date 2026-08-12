/**
 * The task suite and its scorecard — slice 14, §6 of the design document.
 *
 * §6's opening line is the argument for the whole thing: *"Gaits evolved on flat ground are
 * brittle in a way that is invisible until you test them."* Everything before this slice scores
 * a gait on four seconds of flat ground. This is where that bill arrives.
 *
 * **Six tasks, where §6 asked for eight**, and both cuts were forced by measurement rather than
 * by taste:
 *
 * - **Slalom** needs a lateral axis to put a gate beside and a steering gene to reach it. The
 *   simulation is sagittal and the genome is eleven numbers, so every gait would fail it
 *   identically for a reason that has nothing to do with the gait. Cut; §4 and §9 record why.
 * - **Rough** needs a segmented ground, and a segmented ground costs more than roughness does.
 *   Measured over five independently evolved gaits, flat ground gave a mean 3.80 m and rough
 *   ground gave 1.70 m at *zero* amplitude, 1.14 m at 1 cm and 1.15 m at 3 cm. The seams cost
 *   about 2 m and the terrain about 0.5, so the task would have reported the collider. Cut, by
 *   the rule below.
 *
 * > **A task whose own parameter barely moves its result is broken, not hard.**
 *
 * Pure, like everything else here: tasks are data, metrics are functions of a `TrialResult`,
 * and running the trials is somebody else's job. Nothing in this file simulates anything.
 */

import type { Morphology } from './morphology.ts';
import type { TerrainSpec } from './terrain.ts';
import type { TrialResult } from './fitness.ts';

/**
 * How a task turns a trial into one number. **Higher is always better**, so a scorecard never
 * has to remember which way round a metric runs.
 *
 * A key into a record of functions, not §6's "metric expression". Evolab has no expression
 * evaluator, and a parser and a sandbox to avoid a six-entry lookup table is a bad trade — it
 * buys nothing a task author cannot get from the terrain, duration and threshold fields, and it
 * adds a new class of runtime error.
 */
export type MetricKey = 'distance' | 'meanSpeed' | 'travelPerMetre' | 'uprightTime';

export const METRICS: Record<MetricKey, (r: TrialResult) => number> = {
  distance: (r) => r.distance,
  meanSpeed: (r) => (r.duration > 0 ? r.distance / r.duration : 0),
  /**
   * §6 asks Endurance for cost of transport. **That number cannot exist here**, for the same
   * reason `TrialResult.effort` is joint travel rather than joules: Rapier's JavaScript binding
   * exposes no joint impulses, so the torque a motor actually applied cannot be read back.
   *
   * Joint travel per metre ranks gaits the way CoT would for a position-controlled robot, in
   * units that are honest about what was measured. Negated so that higher is better, like every
   * other metric — a gait that thrashes its way along is worse than one that glides.
   */
  travelPerMetre: (r) => (r.distance > 0.1 ? -(r.effort / r.distance) : -1000),
  uprightTime: (r) => r.uprightTime,
};

export const METRIC_UNITS: Record<MetricKey, string> = {
  distance: 'm',
  meanSpeed: 'm/s',
  travelPerMetre: 'rad/m',
  uprightTime: 's',
};

export interface Task {
  readonly key: string;
  readonly name: string;
  /** What failing it tells you. The same job as a challenge card's `teaches`. */
  readonly teaches: string;
  readonly terrain?: TerrainSpec;
  readonly seconds: number;
  /** Payload: a multiplier on the torso's density. */
  readonly torsoDensity?: number;
  /** Shove: fore/aft impulses at the torso, newton-seconds. */
  readonly impulses?: readonly { readonly at: number; readonly x: number }[];
  readonly metric: MetricKey;
  /** Higher is better, so bronze ≤ silver ≤ gold. */
  readonly thresholds: {
    readonly bronze: number;
    readonly silver: number;
    readonly gold: number;
  };
}

const COURSE = 60;

/**
 * The suite.
 *
 * **The thresholds were calibrated, not chosen.** Slice 8 set both archive axis ranges from the
 * textbook and both were wrong; running it is what showed it. The numbers here come from
 * putting real gaits through the suite — see the slice 14 notes for which gaits and what they
 * scored. A task nothing can pass teaches nothing at all, which is the failure mode that
 * matters most on a screen whose whole job is to be read.
 */
export const TASKS: readonly Task[] = [
  {
    key: 'sprint',
    name: 'Sprint',
    teaches: 'Raw speed on the ground it was evolved on. The one task that flatters a champion.',
    seconds: 4,
    metric: 'meanSpeed',
    thresholds: { bronze: 0.35, silver: 0.9, gold: 1.5 },
  },
  {
    key: 'endurance',
    name: 'Endurance',
    teaches:
      'Effort spent per metre travelled. A gait that thrashes gets there and is still wasteful.',
    seconds: 8,
    metric: 'travelPerMetre',
    thresholds: { bronze: -22, silver: -13, gold: -8 },
  },
  {
    key: 'incline',
    name: 'Incline',
    teaches:
      'Torque headroom and pitch control. Open-loop gaits lean the wrong way on a slope and the '
      + 'slope does not care.',
    terrain: { kind: 'ramp', length: COURSE, degrees: 2 },
    seconds: 4,
    metric: 'distance',
    thresholds: { bronze: 0.3, silver: 0.65, gold: 2.0 },
  },
  {
    key: 'steps',
    name: 'Steps',
    teaches:
      'Swing height. A foot that clears the ground by two centimetres clears nothing at all.',
    terrain: { kind: 'steps', length: COURSE, count: 4, rise: 0.04, start: 2, tread: 1.0 },
    seconds: 4,
    metric: 'distance',
    thresholds: { bronze: 1.0, silver: 1.5, gold: 2.2 },
  },
  {
    key: 'shove',
    name: 'Shove',
    teaches:
      'Recovery from a disturbance the gait never saw while evolving — the closest this '
      + 'controller comes to being asked a question.',
    seconds: 4,
    // Retarding, not forward. Measured, a forward impulse saturates: 20, 40 and 80 N·s all give
    // about the same distance, because any of them large enough to matter simply causes a fall.
    // A backward shove has to be walked out of, and that discriminates.
    impulses: [{ at: 1.5, x: -25 }],
    metric: 'distance',
    thresholds: { bronze: 0.0, silver: 1.0, gold: 3.0 },
  },
  {
    key: 'payload',
    name: 'Payload',
    teaches:
      'Robustness to a change in the model. The body is not the one the gait was tuned on, and '
      + 'nothing about the genome knows that.',
    seconds: 4,
    torsoDensity: 1.25,
    metric: 'distance',
    thresholds: { bronze: 0.9, silver: 1.6, gold: 2.5 },
  },
];

/**
 * Seeds every task runs on.
 *
 * §6: *"a gait that clears the steps once in five is a gait that does not clear the steps."*
 * Fixed and stated, so two scorecards are comparable — the same argument as
 * `IslandConfig.trialSeed`, one level up.
 */
export const TASK_SEEDS: readonly number[] = [11, 97, 233, 401, 977];

/**
 * The body a task runs on.
 *
 * Only Payload changes it, and it changes **the torso alone** — §6 asks for "+25% torso mass",
 * not a uniformly heavier robot, and the two test different things. Scaling everything would
 * also scale the legs that have to carry it, which is very nearly no change at all.
 *
 * Returns the morphology unchanged when a task has no payload, so the common case allocates
 * nothing and the identity is preserved rather than merely equal.
 */
export function taskMorphology(morph: Morphology, task: Task): Morphology {
  if (task.torsoDensity === undefined) return morph;
  return {
    ...morph,
    segments: morph.segments.map((s) =>
      s.id === 'torso' ? { ...s, density: s.density * task.torsoDensity! } : s,
    ),
  };
}

export type Badge = 'fail' | 'bronze' | 'silver' | 'gold';

const ORDER: readonly Badge[] = ['fail', 'bronze', 'silver', 'gold'];

export function badgeOf(task: Task, value: number): Badge {
  if (value >= task.thresholds.gold) return 'gold';
  if (value >= task.thresholds.silver) return 'silver';
  if (value >= task.thresholds.bronze) return 'bronze';
  return 'fail';
}

export interface TaskScore {
  readonly task: Task;
  /** Median across the seeds — not the mean, which one lucky run can carry. */
  readonly median: number;
  readonly low: number;
  readonly high: number;
  readonly fell: number;
  readonly badge: Badge;
  readonly values: readonly number[];
}

export interface Scorecard {
  readonly tasks: readonly TaskScore[];
  /**
   * The worst badge across every task.
   *
   * §6's rule, and the good one: *"requires a minimum score in every task, so a sprint
   * specialist cannot buy a gold with speed alone."* A single number would let a gait average
   * its way out of a weakness, which is precisely the weakness the suite exists to find.
   */
  readonly overall: Badge;
  readonly passed: number;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : ((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * One task's trials → its score. The spread is reported because a wide one is a warning.
 *
 * **Falling caps the badge at bronze**, and that rule earned itself immediately: the reference
 * champion covers 2.37 m on Steps before going down, which cleared gold, and the first
 * scorecard printed `5/5 fell` and `GOLD` on the same line. A distance reached by toppling
 * forwards is a real distance and worth some credit, but it is not a gait that clears the steps
 * — which is exactly what §6 means by *"a gait that clears the steps once in five is a gait
 * that does not clear the steps."*
 *
 * The threshold is a majority rather than all five, so one unlucky seed does not erase a badge
 * and three do.
 */
export function scoreTask(task: Task, results: readonly TrialResult[]): TaskScore {
  const values = results.map(METRICS[task.metric]);
  const sorted = [...values].sort((a, b) => a - b);
  const fell = results.filter((r) => r.fell).length;
  const earned = badgeOf(task, median(sorted));
  const capped = fell * 2 > results.length && earned !== 'fail' ? 'bronze' : earned;
  return {
    task,
    median: median(sorted),
    low: sorted[0] ?? 0,
    high: sorted[sorted.length - 1] ?? 0,
    fell,
    badge: capped,
    values,
  };
}

/** Every task's trials → the scorecard. Pure: the trials were run somewhere else. */
export function buildScorecard(byTask: ReadonlyMap<string, readonly TrialResult[]>): Scorecard {
  const tasks = TASKS.filter((t) => byTask.has(t.key)).map((t) =>
    scoreTask(t, byTask.get(t.key)!),
  );
  let worst = ORDER.length - 1;
  for (const t of tasks) worst = Math.min(worst, ORDER.indexOf(t.badge));
  return {
    tasks,
    overall: tasks.length === 0 ? 'fail' : ORDER[worst]!,
    passed: tasks.filter((t) => t.badge !== 'fail').length,
  };
}
