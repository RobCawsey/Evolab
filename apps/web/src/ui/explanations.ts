/**
 * What each operator is doing, in plain language.
 *
 * Data keyed by stage id, not strings buried in the view (§7 of the design document). The
 * point is that these become the explanation layer proper in slice 6 — authored as data,
 * checkable in CI, and written against live values rather than as documentation.
 *
 * The `read` line is the one that matters. It says what to look at on screen, because a
 * learner who does not know where to look has not been taught anything.
 */

import type { Stage } from '@evolab/evolution';

export interface Explanation {
  readonly title: string;
  readonly what: string;
  readonly read: string;
  /** The concept this stage teaches, for the ladder in §7. */
  readonly concept: string;
}

export const EXPLANATIONS: Record<Stage['stage'], Explanation> = {
  population: {
    title: 'The population',
    concept: 'population & fitness',
    what:
      'Every genome that will compete this generation. Each is eleven numbers between 0 and 1, ' +
      'decoded into the same gait parameters the sliders expose.',
    read:
      'Cells are shaded by value, so two strips that look alike are two similar robots. ' +
      'A population that all looks the same has converged.',
  },
  evaluate: {
    title: 'Evaluate',
    concept: 'fitness',
    what:
      'Each genome drives a robot for one trial and is scored on how far it travelled, how ' +
      'long it stayed upright, and how much joint travel it spent doing it.',
    read:
      'Most early genomes score near zero because they fall immediately. The few that do not ' +
      'are what the whole search is built from.',
  },
  select: {
    title: 'Select',
    concept: 'selection pressure',
    what:
      'Three individuals are drawn at random and the fittest becomes a parent. That happens ' +
      'twice, to get two parents.',
    read:
      'Watch the two that are discarded. Selection is not "pick the best" — a weak individual ' +
      'that happens to be drawn against two weaker ones still wins. That looseness is what ' +
      'keeps variety in the population.',
  },
  crossover: {
    title: 'Crossover',
    concept: 'recombination',
    what:
      'The two parents are blended gene by gene to make two children. Each position is either ' +
      'interpolated between the parents or copied straight through unchanged.',
    read:
      'Tinted cells were copied — violet from parent A, cyan from parent B. Plain cells were ' +
      'blended, and sit somewhere between the two parents rather than at either.',
  },
  mutate: {
    title: 'Mutate',
    concept: 'mutation rate',
    what:
      'Each gene has a small chance of being nudged. Most nudges are tiny; occasionally one ' +
      'is large enough to jump somewhere new.',
    read:
      'Amber cells moved. Usually one or two per genome — turn the rate up and the search ' +
      'thrashes, turn it down and it stops exploring at all.',
  },
  replace: {
    title: 'Replace',
    concept: 'elitism',
    what:
      'The children become the next generation. The two fittest individuals are copied across ' +
      'untouched, so the best gait found so far can never be lost.',
    read:
      'That copying is why the best-fitness line only ever goes up. Switch elitism off and it ' +
      'wanders down as well, which looks exactly like a bug in the operators.',
  },
};

/** One-line label for the stage list. */
export const STAGE_ORDER: readonly Stage['stage'][] = [
  'population', 'evaluate', 'select', 'crossover', 'mutate', 'replace',
];
