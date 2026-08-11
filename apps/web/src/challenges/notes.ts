/**
 * The explanation layer — §7's "explanations that cannot rot".
 *
 * One note per concept, plain language, short. A `?` control on a panel opens the note in
 * the right rail: no tooltips, no modals, no tour that hijacks the pointer.
 *
 * A test asserts **both directions** — every concept a challenge teaches has a note here, and
 * every note here is taught by some challenge. That is what stops the explanation layer
 * drifting from the product, and it is the same class of guard as slice 10's palette test:
 * two files that must agree, checked rather than asked politely.
 *
 * Notes are static text; the *live numbers* live in challenge afterwords, which interpolate
 * the run's actual outcome. A note says what duty factor is; an afterword says yours is 0.80.
 */

import type { ConceptNote } from './types.ts';

export const NOTES: readonly ConceptNote[] = [
  {
    id: 'population',
    name: 'Population and fitness',
    text:
      'A genetic algorithm never improves one design — it keeps a whole population of them and ' +
      'improves the population. Every robot gets the same trial and comes back with one number. ' +
      'Nobody designed any of them: generation zero is random, which is why most of it falls over.',
  },
  {
    id: 'selection',
    name: 'Selection pressure',
    text:
      'To make a child you first pick parents, and picking the fitter ones more often is the ' +
      'entire mechanism by which the population improves. A tournament draws three at random and ' +
      'keeps the best — so a weak genome can still get lucky, which is what stops the search ' +
      'collapsing onto one answer immediately.',
  },
  {
    id: 'crossover',
    name: 'Crossover',
    text:
      'A child is built from two parents, gene by gene. It is not an average: each gene lands ' +
      'somewhere between the parents’ values, usually near one of them. That is how a good ' +
      'stride length from one robot meets a good hip phase from another.',
  },
  {
    id: 'mutation',
    name: 'Mutation rate',
    text:
      'Crossover can only recombine what the population already has. Mutation is where genuinely ' +
      'new values come from — a small random nudge to a gene or two. Too little and the search ' +
      'stalls on whatever it started with; too much and it never settles, because every good ' +
      'gait is immediately scrambled.',
  },
  {
    id: 'elitism',
    name: 'Elitism',
    text:
      'The best genomes are copied into the next generation untouched. Without it the best gait ' +
      'you have ever seen can be crossed over, mutated and lost — and the best-fitness line, ' +
      'which should only ever climb, starts falling.',
  },
  {
    id: 'diversity',
    name: 'Convergence and diversity',
    text:
      'Diversity is how spread out the population is in gene space. It falls as the search ' +
      'converges, which is normal — but a flat fitness line and a collapsed diversity line ' +
      'together mean the population has become copies of one answer and has nothing left to ' +
      'recombine. That is a stalled run, not a finished one.',
  },
  {
    id: 'local-optima',
    name: 'Local optima',
    text:
      'A shuffling gait that will not improve is often not the best answer — it is the best ' +
      'answer *near where the search happened to start*. Every small change makes it worse, so ' +
      'nothing can climb out. A different random seed starts somewhere else and may find a ' +
      'better hill entirely.',
  },
  {
    id: 'fitness-design',
    name: 'Fitness design',
    text:
      'The score is a proxy for what you actually want, and evolution optimises the proxy — not ' +
      'the intent. If only distance is scored, throwing itself forward beats walking, and the ' +
      'search will find that out even though you did not intend it. This is the most useful ' +
      'thing in the whole application: the robot is not broken, the goal is.',
  },
  {
    id: 'quality-diversity',
    name: 'Quality and diversity',
    text:
      'Best fitness is one number and it hides everything else the search found. The behaviour ' +
      'map files every surviving gait by how it moved rather than how well — stride length ' +
      'across, duty factor up — so you can see that there are several different ways to walk ' +
      'the same distance. Nothing selects for spread, so the spread is a fact about the search.',
  },
  {
    id: 'stance-swing',
    name: 'Stance and swing',
    text:
      'A leg is either on the ground carrying weight (stance) or in the air moving forward ' +
      '(swing). The footfall diagram draws one bar per foot, filled during stance. Where the ' +
      'two bars overlap, both feet are down — that is double support, and it is what makes a ' +
      'walk a walk rather than a run.',
  },
  {
    id: 'duty-factor',
    name: 'Duty factor',
    text:
      'The fraction of the time a foot spends on the ground. Above 0.5 there is always at least ' +
      'one foot down and it is walking; below 0.5 there is a moment with neither foot down and ' +
      'it is running. At 1.0 it never lifts a foot at all. It is the up axis of the behaviour ' +
      'map, and it is visibly the filled fraction of a footfall bar.',
  },
  {
    id: 'cost-of-transport',
    name: 'Cost of transport',
    text:
      'Getting somewhere is not the only thing worth scoring — how much thrashing it took ' +
      'matters too. Here that is measured as total joint travel in radians, not joules: Rapier ' +
      'does not expose the torque a motor actually applied, so this is an honest stand-in ' +
      'rather than real energy. It penalises exactly the failure worth penalising, which is ' +
      'frantic high-frequency flailing.',
  },
];

const BY_ID = new Map(NOTES.map((n) => [n.id, n]));

export function noteById(id: string): ConceptNote | null {
  return BY_ID.get(id) ?? null;
}
