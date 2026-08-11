import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY, clearProgress, completeCard, completed, conceptCount, dismissNote, loadProgress,
  saveProgress, understands,
} from '../src/challenges/progress.ts';

/** A minimal localStorage, since these tests run in Node. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    get size() { return map.size; },
  };
}

function useStorage(store: ReturnType<typeof fakeStorage>): void {
  vi.stubGlobal('localStorage', store);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('recording progress', () => {
  it('marks concepts, not just cards', () => {
    // §7 and Fig 9.2 note 4: the panel answers "what do I understand now", so two cards
    // teaching fitness-design mark one concept between them.
    let p = completeCard(EMPTY, 'naive-objective', ['fitness-design']);
    p = completeCard(p, 'guard-rails', ['fitness-design']);
    expect(p.cards).toEqual(['naive-objective', 'guard-rails']);
    expect(p.concepts).toEqual(['fitness-design']);
    expect(conceptCount(p)).toBe(1);
    expect(understands(p, 'fitness-design')).toBe(true);
    expect(completed(p, 'guard-rails')).toBe(true);
  });

  it('does not mutate the record it was given', () => {
    const before = completeCard(EMPTY, 'a', ['x']);
    const after = completeCard(before, 'b', ['y']);
    expect(before.cards).toEqual(['a']);
    expect(after.cards).toEqual(['a', 'b']);
  });

  it('keeps a dismissal permanent per concept', () => {
    // Being re-taught something you know is the fastest way to lose an intermediate user.
    const p = dismissNote(dismissNote(EMPTY, 'duty-factor'), 'duty-factor');
    expect(p.dismissed).toEqual(['duty-factor']);
  });
});

describe('surviving whatever is in storage', () => {
  it('round-trips', () => {
    useStorage(fakeStorage());
    const p = dismissNote(completeCard(EMPTY, 'elitism', ['elitism']), 'elitism');
    saveProgress(p);
    expect(loadProgress()).toEqual(p);
  });

  it('returns an empty record when there is nothing stored', () => {
    useStorage(fakeStorage());
    expect(loadProgress()).toEqual(EMPTY);
  });

  it('discards junk rather than throwing on boot', () => {
    // localStorage is user-writable and outlives any version of this file. A hand-edited key
    // or a format change from a future slice must degrade to "no progress", not take the
    // whole app down before the first frame.
    for (const junk of ['not json', 'null', '42', '"a string"', '[]', '{"concepts":"nope"}']) {
      useStorage(fakeStorage({ 'evolab.progress.v1': junk }));
      expect(loadProgress(), `on ${junk}`).toEqual(EMPTY);
    }
  });

  it('keeps the good half of a partly broken record', () => {
    useStorage(fakeStorage({
      'evolab.progress.v1': '{"concepts":["elitism",7,"elitism"],"cards":null}',
    }));
    expect(loadProgress()).toEqual({ concepts: ['elitism'], cards: [], dismissed: [] });
  });

  it('does not throw when storage is unavailable', () => {
    // Private browsing, a full quota, or storage blocked outright. The app should forget,
    // not fail.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(() => loadProgress()).not.toThrow();
    expect(loadProgress()).toEqual(EMPTY);
    expect(() => saveProgress(EMPTY)).not.toThrow();
    expect(() => clearProgress()).not.toThrow();
  });
});
