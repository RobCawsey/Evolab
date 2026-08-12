/**
 * Every keyboard shortcut, as data — slice 15.
 *
 * Extracted from a `keydown` handler in `main.ts` for one reason: **the help section lists
 * these, and a list typed out by hand is a second description that rots.** Now there is one
 * array, the handler dispatches from it and help renders it, and a shortcut cannot appear in
 * the documentation without existing or exist without being documented.
 *
 * The same argument as `notes.ts` and its two-way test, one level down: two things that must
 * agree are checked rather than asked politely.
 */

export interface Shortcut {
  /** Matched against `KeyboardEvent.key`, case-insensitively, or `code` when `useCode`. */
  readonly key: string;
  /** `Space` has to match on `code`, because `key` for it is a literal space. */
  readonly useCode?: boolean;
  /** How the key is drawn in help. */
  readonly label: string;
  /** What it does, in the second person, for a reader who has not used the app before. */
  readonly does: string;
  /** Whether it belongs in the help list. `Escape` works but is not worth a row. */
  readonly listed?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    key: 'Space', useCode: true, label: 'Space', listed: true,
    does: 'Start or pause the search. The replay keeps running either way.',
  },
  {
    key: 'r', label: 'R', listed: true,
    does: 'Reset — throw away the population and start the search from generation zero.',
  },
  {
    key: 'm', label: 'M', listed: true,
    does: 'Switch the stage between the gait you set with the sliders and the evolved champion.',
  },
  {
    key: '2', label: '2', listed: true,
    does: 'Show the flat side-on view. This is the one to debug with.',
  },
  {
    key: '3', label: '3', listed: true,
    does: 'Show the same robot in 3D. The physics is unchanged — only the drawing is.',
  },
  {
    key: 's', label: 'S', listed: true,
    does: 'Open the stepper, which pauses the algorithm between operators and shows each one.',
  },
  {
    key: '?', label: '?', listed: true,
    does: 'Open this help, from anywhere in the app.',
  },
  {
    key: 'Escape', label: 'Esc', listed: false,
    does: 'Close whatever is open — help, the stepper, or a side drawer.',
  },
];

/** The rows help draws. `Escape` is real and works; it is not worth a row of its own. */
export const LISTED_SHORTCUTS = SHORTCUTS.filter((s) => s.listed);

/** Which shortcut an event is, or null. Case-insensitive, because `Shift` should not matter. */
export function shortcutFor(event: KeyboardEvent): Shortcut | null {
  for (const s of SHORTCUTS) {
    if (s.useCode ? event.code === s.key : event.key.toLowerCase() === s.key.toLowerCase()) {
      return s;
    }
  }
  return null;
}
