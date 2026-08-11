import { describe, expect, it } from 'vitest';
import { chooseOverflow, type ToolbarItem } from '../src/ui/toolbar.ts';

/** The real bar, roughly: eight groups, widths as measured at 1440 px. */
const BAR: readonly ToolbarItem[] = [
  { id: 'stages', width: 168, priority: 7 },
  { id: 'btn-run', width: 54, priority: 8 },
  { id: 'btn-reset', width: 60, priority: 3 },
  { id: 'modes', width: 130, priority: 4 },
  { id: 'btn-adopt', width: 176, priority: 1 },
  { id: 'views', width: 74, priority: 5 },
  { id: 'btn-challenges', width: 92, priority: 6 },
  { id: 'btn-stepper', width: 168, priority: 2 },
];

const GAP = 10;
const MORE = 32;

describe('packing the toolbar', () => {
  it('moves nothing when everything fits', () => {
    expect(chooseOverflow(BAR, 2000, GAP, MORE)).toEqual([]);
  });

  it('gives up the long labels first', () => {
    // Priority is the order things are surrendered in, and the two widest buttons are also
    // the two least used — "Copy champion to sliders" and "Show me how this works".
    const moved = chooseOverflow(BAR, 800, GAP, MORE);
    expect(moved[0]).toBe('btn-adopt');
    expect(moved[1]).toBe('btn-stepper');
  });

  it('keeps Run to the very last', () => {
    // A toolbar without Run is not a toolbar. It has the highest priority, so it is only
    // surrendered when literally everything else already has been.
    const moved = chooseOverflow(BAR, 120, GAP, MORE);
    expect(moved).not.toContain('btn-run');
  });

  it('counts the overflow button itself against the space', () => {
    // The bug this guards: collapse until the remaining items fit, forget that the "⋯"
    // button now needs room too, and the bar is still one button too wide — so the whole
    // exercise achieves nothing and the clipping is unchanged.
    const width = (ids: readonly string[]) => {
      const kept = BAR.filter((i) => !ids.includes(i.id));
      return kept.reduce((n, i) => n + i.width, 0) + (kept.length - 1) * GAP;
    };
    for (const available of [300, 500, 700, 900, 1100]) {
      const moved = chooseOverflow(BAR, available, GAP, MORE);
      if (moved.length === 0) continue;
      expect(width(moved) + GAP + MORE, `at ${available}px`).toBeLessThanOrEqual(available);
    }
  });

  it('never moves an item the current stage has hidden', () => {
    // Zero-width items are hidden by `.explorer-only`. Moving one would put an entry in the
    // menu that is invisible now and appears from nowhere when the stage changes.
    const guided = BAR.map((i) =>
      i.id === 'btn-run' || i.id === 'btn-reset' || i.id === 'modes' || i.id === 'btn-adopt'
        ? { ...i, width: 0 }
        : i);
    const moved = chooseOverflow(guided, 200, GAP, MORE);
    expect(moved).not.toContain('btn-run');
    expect(moved).not.toContain('btn-adopt');
    expect(moved.every((id) => guided.find((i) => i.id === id)!.width > 0)).toBe(true);
  });

  it('stops rather than emptying the bar completely', () => {
    // At an absurd width everything movable goes, but the loop has to terminate and leave
    // one control rather than looping on an empty list.
    const moved = chooseOverflow(BAR, 10, GAP, MORE);
    expect(moved.length).toBe(BAR.length - 1);
    expect(moved).not.toContain('btn-run');
  });

  it('is stable — packing the same bar twice gives the same answer', () => {
    // The DOM side re-runs this on every resize tick. An unstable result would move controls
    // in and out of the menu while the window is being dragged.
    const a = chooseOverflow(BAR, 640, GAP, MORE);
    const b = chooseOverflow(BAR, 640, GAP, MORE);
    expect(a).toEqual(b);
  });

  it('surrenders more as the window narrows, never fewer', () => {
    let previous = 0;
    for (const available of [1200, 1000, 800, 600, 400, 200]) {
      const moved = chooseOverflow(BAR, available, GAP, MORE).length;
      expect(moved, `at ${available}px`).toBeGreaterThanOrEqual(previous);
      previous = moved;
    }
  });
});
