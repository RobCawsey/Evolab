/**
 * The eleven cards. §7's concept ladder, in the order a learner hits the need for each.
 *
 * Nothing here is locked. Later cards are dimmed as guidance, never gated — a reader who
 * already knows this material starts anywhere, and §7's decision on freely switchable stages
 * applies to the track too.
 *
 * Every card is data: no functions, no dates, nothing that will not survive
 * `JSON.parse(JSON.stringify(...))`. A test checks that, so slice 12 can move this to a fetch
 * without rewriting it.
 *
 * **Afterwords branch on the outcome.** Slice 6 established why: evolution does not reliably
 * misbehave, and copy asserting a face-plant after a run where the robot walked teaches the
 * reader to stop reading. Every card whose lesson depends on a particular result carries both
 * branches, and a test renders both.
 */

import type { Challenge } from './types.ts';

export const CHALLENGES: readonly Challenge[] = [
  {
    id: 'first-population',
    phase: 'How the algorithm works',
    title: 'Twenty-four robots, none of them designed',
    teaches: ['population'],
    brief:
      'Generation zero is random. Nobody chose any of these gaits, and most of them will not ' +
      'survive the first second.',
    task: 'Run 30 generations and watch the fitness line climb out of the floor.',
    // Explorer, not guided — see the note on ChallengeSetup.stage. The guided stage hides
    // Run, Reset, the archive and the gait strip, so a card asking for it leaves the learner
    // with a task and nothing to press.
    setup: { stage: 'explorer', goal: 'far', gens: 30, focus: 'chart' },
    success: { metric: 'generations', op: '>=', value: 30 },
    afterword: {
      when: { metric: 'championDistance', op: '>', value: 3 },
      then: {
        text:
          'From random noise to {championDistance} m, in {generations} generations and without ' +
          'anyone designing a step. The first generation managed {firstDistance} m. Nothing in ' +
          'the population knew what walking was — it only knew which of them got further.',
      },
      otherwise: {
        text:
          'It reached {championDistance} m, up from {firstDistance} m. Modest, and still the ' +
          'point: no gait here was designed. Try running it again — a different starting ' +
          'population finds a different answer, and sometimes a much better one.',
      },
    },
  },
  {
    id: 'selection',
    phase: 'How the algorithm works',
    title: 'Watch two of three get thrown away',
    teaches: ['selection'],
    brief:
      'Improvement has to come from somewhere. It comes from picking parents unfairly — the ' +
      'fitter ones get chosen more often.',
    task: 'Open the stepper and step through a tournament. Watch three genomes go in and one come out.',
    setup: { stage: 'explorer', focus: 'stepper' },
    // Checks the operator the card asks you to watch, not the pool — the stepper runs its
    // own island, so a pool-based check could not be satisfied by doing what the card says.
    success: { metric: 'stepperSelections', op: '>=', value: 1 },
    afterword: {
      text:
        'Three drawn at random, the best one kept. Run it enough times and fitter genomes become ' +
        'parents more often — but not always, because a weak genome that draws two weaker ones ' +
        'still wins. That slack is what stops the whole population collapsing onto one answer ' +
        'in three generations.',
    },
  },
  {
    id: 'crossover',
    phase: 'How the algorithm works',
    title: 'Where does a child come from?',
    teaches: ['crossover'],
    brief: 'Two parents, one child, gene by gene — and the child is not an average of them.',
    task: 'In the stepper, step to a crossover and read the gene strips: parent, parent, child.',
    setup: { stage: 'explorer', focus: 'stepper' },
    success: { metric: 'stepperCrossovers', op: '>=', value: 1 },
    afterword: {
      text:
        'Each gene lands somewhere between the two parents, usually close to one of them rather ' +
        'than halfway. That is what lets a good stride length from one robot meet a good hip ' +
        'phase from another instead of blurring both into mush.',
    },
  },
  {
    id: 'naive-objective',
    phase: 'What you are asking for',
    title: 'Ten metres, any way you can',
    teaches: ['fitness-design'],
    brief:
      'This goal scores distance and nothing else. No upright term, no effort term. Exactly ' +
      'what you would write first.',
    task: 'Run it, then look hard at what won.',
    setup: { stage: 'explorer', goal: 'naive', gens: 30, focus: 'chart' },
    success: { metric: 'generations', op: '>=', value: 30 },
    afterword: {
      when: { metric: 'championFell', op: '==', value: 1 },
      then: {
        text:
          'There it is. It fell after {championUpright} s of a {trialSeconds} s trial and still ' +
          'scored best, because with only distance counted, throwing itself forward beats ' +
          'walking. It covered {championDistance} m doing it. The robot is not broken and the ' +
          'search is not cheating — both did exactly what you asked. The goal is wrong.',
      },
      otherwise: {
        text:
          'This time it walked, and covered {championDistance} m without falling. Worth ' +
          'noticing that this is luck rather than design: nothing in this goal rewarded staying ' +
          'upright, so nothing stopped a diving gait winning — it simply did not find one. Run ' +
          'it again with a different seed and watch how reliable that is.',
      },
    },
  },
  {
    id: 'guard-rails',
    phase: 'What you are asking for',
    title: 'Put the guard rails back',
    teaches: ['fitness-design'],
    brief:
      'Same track, same robot. The goal now pays for staying upright as well as for distance.',
    task: 'Run it and compare against the last card — distance may well be lower.',
    setup: { stage: 'explorer', goal: 'far', gens: 30, focus: 'chart' },
    success: {
      all: [
        { metric: 'generations', op: '>=', value: 30 },
        { metric: 'championFell', op: '==', value: 0 },
      ],
    },
    afterword: {
      when: { metric: 'championFell', op: '==', value: 0 },
      then: {
        text:
          '{championDistance} m, upright the whole way. If that is less than the diving run ' +
          'managed, that is the trade working as intended: you gave up peak distance to buy a ' +
          'gait that is still standing at the end. Every term in a fitness function is a ' +
          'sentence about what you will not accept.',
      },
      otherwise: {
        text:
          'It still fell, after {championUpright} s. The upright term makes falling expensive, ' +
          'not impossible — with distance weighted heavily enough, a fast enough dive can still ' +
          'pay for itself. Try "Travel without wasting effort", which charges for the flailing too.',
      },
    },
  },
  {
    id: 'elitism',
    phase: 'Making the search work',
    title: 'Lose the best one',
    teaches: ['elitism'],
    brief:
      'Elitism copies the best genomes forward untouched. This card switches it off, so every ' +
      'genome in every generation is a child of the last.',
    task: 'Run 30 generations and watch the best-fitness line, which should only ever climb.',
    setup: { stage: 'explorer', goal: 'far', gens: 30, config: { elites: 0 }, focus: 'chart' },
    success: { metric: 'generations', op: '>=', value: 30 },
    afterword: {
      when: { metric: 'bestDips', op: '>=', value: 1 },
      then: {
        // Phrased so the count reads correctly at any value — "{bestDips} times" would print
        // "1 times" on the run where the lesson only just happens.
        text:
          'Best fitness went down on {bestDips} of the generations you just watched. Without ' +
          'elitism the best gait found so far can be picked as a parent, crossed over, mutated ' +
          'and lost — so the population genuinely gets worse from one generation to the next. ' +
          'Two elites is all it takes to make that impossible, and it is why every other run in ' +
          'this app has a best line that only climbs.',
      },
      otherwise: {
        text:
          'The line held up this time, which is luck rather than safety: with elitism off ' +
          'nothing was protecting the best gait, and no run is obliged to lose it. Run it ' +
          'again. What elitism buys is not a better search — it is the guarantee that the best ' +
          'thing you have found cannot be thrown away, and a guarantee is not the same as ' +
          'having got away with it.',
      },
    },
  },
  {
    id: 'mutation-rate',
    phase: 'Making the search work',
    title: 'Too little, too much',
    teaches: ['mutation'],
    brief:
      'Mutation is the only source of values the population does not already contain. This ' +
      'card turns it almost off.',
    task: 'Run it, then open Lab and try again with the rate turned up.',
    setup: {
      stage: 'explorer', goal: 'far', gens: 30, config: { mutationRate: 0.001 }, focus: 'chart',
    },
    success: { metric: 'generations', op: '>=', value: 30 },
    afterword: {
      text:
        'It reached {championDistance} m and diversity ended at {diversity}. With mutation this ' +
        'low, crossover can only shuffle the genes the first random population happened to ' +
        'contain — once those are exhausted the search has nowhere new to go. Turn it too far ' +
        'the other way and the opposite happens: every good gait is scrambled before it can be ' +
        'built on.',
    },
  },
  {
    id: 'stalled',
    phase: 'Making the search work',
    title: 'It stopped improving at generation 12',
    teaches: ['diversity', 'local-optima'],
    brief:
      'A flat fitness line can mean the search has finished, or that it has run out of ideas. ' +
      'The diversity line tells you which.',
    task: 'Run 40 generations, then watch the amber line flatten while the violet one falls.',
    setup: { stage: 'explorer', goal: 'far', gens: 40, focus: 'chart' },
    success: { metric: 'generations', op: '>=', value: 40 },
    afterword: {
      when: { metric: 'diversity', op: '<', value: 0.15 },
      then: {
        text:
          'Diversity finished at {diversity}. The population has become copies of one answer, ' +
          'so crossover has nothing left to recombine and only mutation can move anything. ' +
          'That is a converged run — and if {championDistance} m is not good enough, no amount ' +
          'of extra generations will fix it. A different seed starts on a different hill.',
      },
      otherwise: {
        text:
          'Diversity held up at {diversity}, so this population still had room to move. Best ' +
          'reached {championDistance} m. Watch the two lines together on the next run: when the ' +
          'amber flattens *and* the violet collapses, more generations will not help you.',
      },
    },
  },
  {
    id: 'repertoire',
    phase: 'How to read a gait',
    title: 'Three ways to walk the same distance',
    teaches: ['quality-diversity'],
    brief:
      'Best fitness is one number, and it hides everything else the search found on the way.',
    task: 'Run 30 generations, then hover cells across the behaviour map and click one to load it.',
    setup: { stage: 'explorer', goal: 'far', gens: 30, focus: 'archive' },
    success: {
      all: [
        { metric: 'generations', op: '>=', value: 30 },
        { metric: 'archiveCells', op: '>=', value: 40 },
      ],
    },
    afterword: {
      text:
        'The map filled {archiveCells} of its 576 cells — {coverage} coverage. Every one of ' +
        'those is a gait that survived a whole trial, filed by *how* it moved rather than how ' +
        'well. Nothing in the score mentions stride length or duty factor, so the spread is a ' +
        'fact about what the search found rather than what it was told to look for. A run that ' +
        'ends with one brilliant cell and 575 empty ones has not explored.',
    },
  },
  {
    id: 'footfalls',
    phase: 'How to read a gait',
    title: 'Read the footfalls',
    teaches: ['stance-swing', 'duty-factor'],
    brief:
      'Every gait has a rhythm, and the footfall diagram is the notation the field actually ' +
      'uses for it.',
    task: 'Run 30 generations, switch to the evolved champion, and read the two bars under the stage.',
    setup: { stage: 'explorer', goal: 'far', gens: 30, focus: 'gait' },
    success: {
      all: [
        { metric: 'generations', op: '>=', value: 30 },
        { metric: 'championFell', op: '==', value: 0 },
      ],
    },
    afterword: {
      when: { metric: 'championDuty', op: '>', value: 0.5 },
      then: {
        text:
          'Duty factor {championDuty}: each foot is on the ground that fraction of the time. ' +
          'Above 0.5 there is always at least one foot down, so this is walking rather than ' +
          'running — and the stretches where both bars are filled are double support. It takes ' +
          '{championStride} m per stride to do it.',
      },
      otherwise: {
        text:
          'Duty factor {championDuty} — below 0.5, meaning there are moments with neither foot ' +
          'on the ground. That is running, and it is rare for this morphology. Worth looking at ' +
          'where it sits on the behaviour map: almost nothing else got down there.',
      },
    },
  },
  {
    id: 'cost-of-transport',
    phase: 'How to read a gait',
    title: 'The fastest gait is not the cheapest',
    teaches: ['cost-of-transport'],
    brief:
      'This goal charges for every degree of joint movement. Distance still counts, but ' +
      'thrashing is no longer free.',
    task: 'Run it and compare the distance and the effort against "Travel as far as you can".',
    setup: { stage: 'explorer', goal: 'efficient', gens: 30, focus: 'gait' },
    success: { metric: 'generations', op: '>=', value: 30 },
    afterword: {
      text:
        '{championDistance} m for {championEffort} radians of total joint travel. Against the ' +
        'unpenalised goal that is usually less distance and much less flailing — a longer, ' +
        'calmer stride rather than a frantic one. Worth being precise about what was measured: ' +
        'this is joint travel, not joules. Rapier does not expose the torque a motor actually ' +
        'applied, so it is an honest stand-in rather than real energy.',
    },
  },
];

export const CHALLENGE_IDS: readonly string[] = CHALLENGES.map((c) => c.id);

export function challengeById(id: string | null): Challenge | null {
  return CHALLENGES.find((c) => c.id === id) ?? null;
}
