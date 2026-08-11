/**
 * What the learner has understood, kept between sessions.
 *
 * **Per concept, not per card** — §7 and Fig 9.2 note 4. The panel answers *what do I
 * understand now*, not *how much have I completed*, so the record is a set of concept ids and
 * the cards are only how they were reached. Two cards teaching `fitness-design` mark one
 * concept, and a learner who arrives already knowing it loses nothing by skipping both.
 *
 * This is the first state in the project that cannot live in the URL, and it is deliberately
 * the smallest possible thing: one `localStorage` key holding a few hundred bytes. Not Dexie,
 * not OPFS — §11's immutability rules matter when *runs* are stored, and this is not that.
 * Real storage arrives with the server in slice 12.
 */

const KEY = 'evolab.progress.v1';

export interface Progress {
  /** Concept ids the learner has demonstrated. */
  readonly concepts: readonly string[];
  /** Challenge ids completed, so the track can tick them. */
  readonly cards: readonly string[];
  /**
   * Concepts whose explanation has been dismissed for good.
   *
   * Permanent per concept rather than per session — §7. Being re-taught something you already
   * know is the fastest way to lose an intermediate user.
   */
  readonly dismissed: readonly string[];
}

export const EMPTY: Progress = { concepts: [], cards: [], dismissed: [] };

/** Strings only, deduplicated, order preserved. Anything else in storage is discarded. */
function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string'))];
}

/**
 * Read the record, tolerating anything.
 *
 * `localStorage` is writable by the user and survives across versions of this file, so the
 * parse is defensive on purpose: a hand-edited key or a format change from a future slice
 * degrades to an empty record rather than throwing on boot and taking the whole app with it.
 * It also throws outright in some privacy modes, hence the try.
 */
export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    const record = parsed as Record<string, unknown>;
    return {
      concepts: cleanList(record['concepts']),
      cards: cleanList(record['cards']),
      dismissed: cleanList(record['dismissed']),
    };
  } catch {
    return EMPTY;
  }
}

/** Write the record. Silently does nothing if storage is unavailable. */
export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Private browsing, a full quota, or a user who has blocked storage. None of those is
    // worth an error dialog over a progress tick — the app works, it just forgets.
  }
}

function withAdded(list: readonly string[], values: readonly string[]): string[] {
  return [...new Set([...list, ...values])];
}

/** Record a completed card and everything it taught. Pure; returns a new record. */
export function completeCard(
  progress: Progress,
  cardId: string,
  teaches: readonly string[],
): Progress {
  return {
    concepts: withAdded(progress.concepts, teaches),
    cards: withAdded(progress.cards, [cardId]),
    dismissed: progress.dismissed,
  };
}

export function dismissNote(progress: Progress, conceptId: string): Progress {
  return { ...progress, dismissed: withAdded(progress.dismissed, [conceptId]) };
}

export function understands(progress: Progress, conceptId: string): boolean {
  return progress.concepts.includes(conceptId);
}

export function completed(progress: Progress, cardId: string): boolean {
  return progress.cards.includes(cardId);
}

/** For the "you understand 7 of 12" line. */
export function conceptCount(progress: Progress): number {
  return progress.concepts.length;
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* see saveProgress */
  }
}
