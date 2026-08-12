/**
 * The help section, as data — slice 15.
 *
 * **Written for somebody who has never seen a genetic algorithm and has just opened the app.**
 * No assumed vocabulary: the first time a word like *genome* or *duty factor* is used it is
 * explained in the same sentence, and every number the app puts on screen has a row in the
 * glossary saying what it is and what a good one looks like.
 *
 * The hard rule here is **do not retype anything that already exists as data.** The app already
 * carries a lot of explanation — twelve concept notes, one per operator in the stepper, a blurb
 * per goal, a `teaches` line per task, a keymap — and a help section that restated any of it
 * would be a second description free to drift. So the generated blocks pull the real thing:
 * `concepts` renders `NOTES`, `goals` renders the presets, `tasks` renders `TASKS`, `keys`
 * renders `LISTED_SHORTCUTS`. Change a preset and help changes with it.
 *
 * What is left is prose that only exists here — orientation, the walkthrough, what each panel
 * is — and the one thing that can rot about *that* is the element ids it names. Those are
 * checked: `help.test.ts` reads `index.html` and asserts every id in `PANELS` is really there.
 */

import { TASKS } from '@evolab/evolution';
import { NOTES } from '../../challenges/notes.ts';
import { PRESETS } from '../../run/objectives.ts';
import { LISTED_SHORTCUTS } from '../keymap.ts';

export type HelpBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'steps'; readonly items: readonly string[] }
  | { readonly kind: 'terms'; readonly items: readonly { readonly term: string; readonly text: string }[] }
  /** One row per panel, keyed by the element it describes so the id can be checked. */
  | { readonly kind: 'panels'; readonly items: readonly { readonly id: string; readonly name: string; readonly text: string }[] }
  | { readonly kind: 'keys' }
  | { readonly kind: 'concepts' }
  | { readonly kind: 'goals' }
  | { readonly kind: 'tasks' };

export interface HelpSection {
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly HelpBlock[];
}

export const HELP: readonly HelpSection[] = [
  {
    id: 'what',
    title: 'What this is',
    blocks: [
      {
        kind: 'p',
        text:
          'Evolab designs two-legged robots and then teaches them to walk — not by programming '
          + 'the walk, but by breeding it. You will not write any instructions for the legs. You '
          + 'set what counts as good, and a search finds a way to be good at it.',
      },
      {
        kind: 'p',
        text:
          'Nothing here is a video or an animation. Every robot on screen is being simulated '
          + 'from its own physics, and every number beside it was measured from that simulation. '
          + 'When a robot falls over it is because it fell over.',
      },
      {
        kind: 'p',
        text:
          'The whole thing runs in this browser tab. There is no account, nothing is uploaded '
          + 'unless you press a button that says so, and closing the tab loses nothing you have '
          + 'not saved.',
      },
      {
        kind: 'terms',
        items: [
          {
            term: 'Three screens, one app',
            text:
              'Guided walks you through a first run in four steps. Explorer adds the panels and '
              + 'the controls. Lab shows everything, including the numbers only a tinkerer wants. '
              + 'They are the same application — switching never restarts anything and nothing is '
              + 'locked, so you can go straight to Lab on your first minute if you want to.',
          },
        ],
      },
    ],
  },

  {
    id: 'first',
    title: 'Your first five minutes',
    blocks: [
      {
        kind: 'p',
        text:
          'If you do nothing else, do this. It takes about a minute of watching and it is the '
          + 'whole idea in miniature.',
      },
      {
        kind: 'steps',
        items: [
          'Press Run. Twenty-four robots you did not design start trying to walk, and almost all '
          + 'of them fall over immediately. That is expected — they were made at random.',

          'Watch the orange line on the fitness chart. It is the best robot in each generation. '
          + 'It climbs, because every generation is built from the ones that did least badly in '
          + 'the last.',

          'Watch the robot on the stage. It is the best one found so far, replayed. It will get '
          + 'visibly better while you look at it — usually from a face-plant to a shuffle to '
          + 'something that reaches the end.',

          'Press Space to pause when it looks like it is walking. Nothing is lost; the replay '
          + 'keeps going.',

          'Now press M. The stage switches to the gait *you* control with the sliders on the '
          + 'left. Drag one and watch the robot change. Press M again to go back to the evolved '
          + 'one and compare.',
        ],
      },
      {
        kind: 'p',
        text:
          'That is the loop. Everything else in the app is a way of looking more closely at what '
          + 'just happened.',
      },
      {
        kind: 'p',
        text:
          'When you want to know *how* it did that rather than *that* it did it, press S. The '
          + 'stepper pauses the algorithm between each of its steps and shows you the actual '
          + 'genomes it is working on — not a diagram of the algorithm, the algorithm itself, '
          + 'held still.',
      },
    ],
  },

  {
    id: 'screen',
    title: 'What each panel is',
    blocks: [
      {
        kind: 'p',
        text:
          'Panels appear as you move from Guided to Explorer to Lab. If something described here '
          + 'is not on your screen, you are probably in a simpler stage — the switch is at the '
          + 'top left. On a narrow window the side panels become drawers you open from the '
          + 'toolbar.',
      },
      {
        kind: 'panels',
        items: [
          {
            id: 'stage',
            name: 'The stage',
            text:
              'The robot, from the side, walking left to right. The faint stripes on the ground '
              + 'are one metre apart, so you can see how far it got without reading a number. '
              + 'The label at the top right says whether you are watching your gait or the '
              + 'evolved champion.',
          },
          {
            id: 'sliders',
            name: 'Gait controls',
            text:
              'Eleven numbers that completely describe how this robot walks. Each joint swings '
              + 'like a pendulum, and you are setting how far it swings, when in the cycle it '
              + 'swings, and what it swings around. These eleven numbers are exactly what '
              + 'evolution is searching through — the robots it breeds have no more freedom '
              + 'than you do here.',
          },
          {
            id: 'editor',
            name: 'Body',
            text:
              'The robot itself: how long its thighs are, how big its feet are, how heavy it is. '
              + 'Change it and the champion is immediately re-drawn on the new legs — usually '
              + 'falling over, because its gait was tuned for the old ones. That is worth doing '
              + 'once on purpose.',
          },
          {
            id: 'chart',
            name: 'Fitness',
            text:
              'One point per generation. Orange is the best robot in that generation, teal is '
              + 'the average, and the dotted line is diversity — how different the population '
              + 'still is. A flat orange line with a falling dotted one means the search has '
              + 'stopped exploring and is polishing one answer.',
          },
          {
            id: 'archive',
            name: 'Behaviour map',
            text:
              'A grid of every *kind* of walk found, rather than of how good they were. Across '
              + 'is stride length — how far it travels per step. Up is duty factor — how much of '
              + 'the time a foot is on the ground. Nothing in the score mentions either, so the '
              + 'spread across the grid is what the search stumbled into rather than what it was '
              + 'told to look for. Click any cell to load that walk into the sliders.',
          },
          {
            id: 'scorecard',
            name: 'Scorecard',
            text:
              'What the gait is worth on ground it was never evolved on. Press the button and it '
              + 'is tested six ways, five times each. Expect it to be humbling — a robot bred on '
              + 'flat ground is usually much worse everywhere else, and finding that out is the '
              + 'point of the panel.',
          },
          {
            id: 'gait',
            name: 'Gait analysis',
            text:
              'The strip under the stage, which appears once there is a recorded run to draw. '
              + 'The bars show which foot is down and when; the wavy lines are the joint angles '
              + 'through the run; the loop on the right is the hip drawn against its own speed, '
              + 'which closes into a ring when a walk has settled into a repeating cycle.',
          },
          {
            id: 'challenges',
            name: 'Challenges',
            text:
              'Eleven cards, each naming one idea and setting the app up to show it in a single '
              + 'click. Nothing is locked. If you would rather be led than poke about, start '
              + 'here.',
          },
          {
            id: 'runs',
            name: 'Saved runs',
            text:
              'Only present when a server is running. Saving is optional and never blocks '
              + 'anything — with no server at all every other part of the app works exactly the '
              + 'same.',
          },
        ],
      },
    ],
  },

  {
    id: 'numbers',
    title: 'Reading the numbers',
    blocks: [
      {
        kind: 'p',
        text:
          'Every measurement the app shows, and what a good one looks like. All units are metric '
          + '— metres, kilograms, seconds.',
      },
      {
        kind: 'terms',
        items: [
          {
            term: 'Fitness',
            text:
              'One number summarising how well a robot did, and the only thing the search pays '
              + 'attention to. It mixes distance, time spent upright and effort together in '
              + 'whatever proportions the goal specifies. It is not in any unit — it is only '
              + 'meaningful compared with another fitness from the same goal.',
          },
          {
            term: 'Generation',
            text:
              'One complete round: score everybody, pick parents, make children, repeat. Thirty '
              + 'of them takes a few seconds.',
          },
          {
            term: 'Diversity',
            text:
              'How different the population still is. It starts high, because generation zero is '
              + 'random, and falls as the search converges. Falling to near zero early is a '
              + 'warning: the population has agreed on one answer and can no longer look '
              + 'elsewhere.',
          },
          {
            term: 'Distance',
            text:
              'How far the torso travelled from where it started, in metres. Can be negative if '
              + 'the robot went backwards, which happens more than you would think.',
          },
          {
            term: 'Upright',
            text:
              'Seconds before falling. If it equals the trial length, it never fell.',
          },
          {
            term: 'Effort',
            text:
              'Total joint movement, in radians added up across every joint. A stand-in for '
              + 'energy, which this simulation cannot measure directly. Its job is to punish '
              + 'frantic thrashing, and it does.',
          },
          {
            term: 'Stride length',
            text:
              'How far the robot travels between one footfall and the next of the *same* foot — '
              + 'one full cycle, so two steps. Zero means it never got the same foot down twice.',
          },
          {
            term: 'Duty factor',
            text:
              'The fraction of the time a foot is on the ground, averaged over both feet. Above '
              + '0.5 there is always at least one foot down and it is walking; below 0.5 there '
              + 'are moments with neither foot down and it is running. Exactly 1.0 means it '
              + 'never lifted a foot at all — a statue, and a surprisingly good scorer on some '
              + 'goals.',
          },
          {
            term: 'Coverage',
            text:
              'What fraction of the behaviour map has ever been filled. A run with one brilliant '
              + 'cell and five hundred empty ones has not explored, whatever its best score says.',
          },
          {
            term: 'Quality–diversity',
            text:
              'The fitness of every filled cell added together — one number for "how many good '
              + 'different answers are there". Watch it next to the best score: they rise '
              + 'together while the search is still finding new kinds of walk, and come apart '
              + 'once it is only refining the ones it has.',
          },
          {
            term: 'Badges',
            text:
              'On the scorecard: gold, silver, bronze or fail per task. The overall badge is the '
              + '*worst* task, not the average, so being fast cannot make up for falling over on '
              + 'the steps. A task where the robot fell in most runs is capped at bronze however '
              + 'far it got.',
          },
        ],
      },
    ],
  },

  {
    id: 'ideas',
    title: 'The ideas behind it',
    blocks: [
      {
        kind: 'p',
        text:
          'Twelve ideas, in the order they tend to make sense. Each of these has a challenge '
          + 'card that sets the app up to show it happening, so if one does not land by reading '
          + 'it, go and watch it instead.',
      },
      { kind: 'concepts' },
    ],
  },

  {
    id: 'goals',
    title: 'What you are asking for',
    blocks: [
      {
        kind: 'p',
        text:
          'The goal decides what counts as a good robot, and it is the single most powerful '
          + 'control in the app. Evolution will do exactly what you ask and nothing else, which '
          + 'is much less convenient than it sounds — the classic result is a goal that scores '
          + 'only distance producing a robot that dives head-first over the line, because diving '
          + 'is a very effective way to move forwards once.',
      },
      { kind: 'goals' },
    ],
  },

  {
    id: 'tasks',
    title: 'The scorecard',
    blocks: [
      {
        kind: 'p',
        text:
          'A gait bred on flat ground is usually brittle in ways that are invisible until you '
          + 'test it. Each task runs five times on different starting conditions and reports the '
          + 'middle result, because something that works once in five does not work.',
      },
      { kind: 'tasks' },
    ],
  },

  {
    id: 'keys',
    title: 'Keyboard',
    blocks: [
      { kind: 'keys' },
      {
        kind: 'p',
        text:
          'Shortcuts are ignored while you are typing in a field, and while the stepper is open.',
      },
    ],
  },
];

/* ---------------- the generated blocks ---------------- */

export interface HelpRow {
  readonly term: string;
  readonly text: string;
}

/** The twelve concept notes, as help rows. Sourced from `notes.ts`, never retyped. */
export const conceptRows = (): readonly HelpRow[] =>
  NOTES.map((n) => ({ term: n.name, text: n.text }));

/** The goal presets, as help rows. Sourced from `objectives.ts`. */
export const goalRows = (): readonly HelpRow[] =>
  PRESETS.map((p) => ({ term: p.name, text: p.blurb }));

/** The scorecard tasks, as help rows. Sourced from the suite itself. */
export const taskRows = (): readonly HelpRow[] =>
  TASKS.map((t) => ({ term: t.name, text: t.teaches }));

/** Every element id the help text claims exists, for the test that checks they do. */
export function referencedIds(): readonly string[] {
  const ids: string[] = [];
  for (const section of HELP) {
    for (const block of section.blocks) {
      if (block.kind === 'panels') for (const item of block.items) ids.push(item.id);
    }
  }
  return ids;
}
