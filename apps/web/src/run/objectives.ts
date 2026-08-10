/**
 * Named goals, as weight vectors over the fitness terms that already exist.
 *
 * A preset is the whole of step 2 in the guided flow: a first-time user picks what the
 * robots are being scored on, in a sentence, without meeting the word "objective" or a
 * single slider.
 */

import type { Objective } from '@evolab/evolution';

export interface Preset {
  readonly key: string;
  readonly name: string;
  /** What the robots are scored on, in the second person. */
  readonly blurb: string;
  /** The concept this goal exists to teach, for §7's ladder. */
  readonly teaches: string;
  readonly objective: Objective;
  /**
   * Shown only *after* a run finishes, never before.
   *
   * Warning up front would remove the lesson — §7 of the design document stages the naive
   * goal deliberately, and the point is that the learner sees the result and then fixes the
   * goal rather than the robot.
   *
   * A function of the outcome, not a fixed string, because evolution does not reliably
   * misbehave. Under the naive goal it *usually* finds a dive, and sometimes it just walks;
   * copy that asserts a face-plant when the robot is plainly still upright teaches the
   * learner to stop reading the copy. This is what §7 means by written against live values.
   */
  readonly afterword?: (outcome: RunOutcome) => string;
}

export interface RunOutcome {
  readonly fell: boolean;
  readonly distance: number;
  readonly uprightTime: number;
  readonly trialSeconds: number;
}

export const PRESETS: readonly Preset[] = [
  {
    key: 'far',
    name: 'Travel as far as you can',
    blurb: 'Get down the track. Staying upright helps, and flailing about costs you.',
    teaches: 'fitness as a trade-off',
    objective: { distance: 1.0, upright: 0.5, effort: 0.3, effortBudget: 140 },
  },
  {
    key: 'upright',
    name: 'Stay on your feet',
    blurb: 'Survive the whole trial. Distance barely matters — just do not fall over.',
    teaches: 'what you reward is what you get',
    objective: { distance: 0.4, upright: 3.0, effort: 0.3, effortBudget: 140 },
    afterword: (o) =>
      o.distance < 1
        ? 'It barely moved — and it was right not to. You rewarded survival above all else, ' +
          'so standing very still is the best answer available. Not cheating: doing exactly ' +
          'what you asked.'
        : `It stayed up and still covered ${o.distance.toFixed(1)} m. Rewarding survival does not ` +
          'forbid walking, it just stops paying much for it.',
  },
  {
    key: 'efficient',
    name: 'Travel without wasting effort',
    blurb: 'Cover ground, but every degree of joint movement is charged for.',
    teaches: 'cost of transport',
    objective: { distance: 1.0, upright: 0.5, effort: 1.5, effortBudget: 70 },
  },
  {
    key: 'naive',
    name: 'Just reach the line, anything goes',
    blurb: 'Only distance is scored. Nothing else counts at all.',
    teaches: 'fitness design',
    objective: { distance: 1.0, upright: 0, effort: 0, effortBudget: Number.MAX_SAFE_INTEGER },
    afterword: (o) =>
      o.fell
        ? `Look at what won. It fell after ${o.uprightTime.toFixed(1)} s and still scored best, ` +
          'because with only distance counted, throwing itself forward beats walking. The ' +
          'robot is not broken — the goal is.'
        : 'This time the search found something that walks, which is luck rather than design: ' +
          'nothing in this goal rewarded staying upright. Run it again, or compare against ' +
          '"Travel as far as you can" — the extra terms are what make a walking gait the ' +
          'reliable answer instead of a fortunate one.',
  },
];

export const DEFAULT_PRESET = PRESETS[0]!;

export function presetByKey(key: string | null): Preset {
  return PRESETS.find((p) => p.key === key) ?? DEFAULT_PRESET;
}
