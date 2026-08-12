import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TASKS } from '@evolab/evolution';
import { NOTES } from '../src/challenges/notes.ts';
import { PRESETS } from '../src/run/objectives.ts';
import { LISTED_SHORTCUTS, SHORTCUTS, shortcutFor } from '../src/ui/keymap.ts';
import {
  conceptRows, goalRows, HELP, panelHeaders, referencedIds, taskRows,
} from '../src/ui/help/content.ts';
import { emphasisParts } from '../src/ui/help/panel.ts';

const html = readFileSync(
  fileURLToPath(new URL('../index.html', import.meta.url)),
  'utf8',
);

describe('help does not describe things that are not there', () => {
  it('names only elements that exist in index.html', () => {
    // The one part of help that is prose rather than generated is "what each panel is", and
    // the thing that can rot about it is the element it claims to describe. Rename a panel and
    // this fails, which is the whole reason the ids are in the data at all.
    for (const id of referencedIds()) {
      expect(html, `#${id} named by help`).toContain(`id="${id}"`);
    }
  });

  it('describes every panel exactly once', () => {
    const ids = referencedIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a Help control for the button that opens it', () => {
    expect(html).toContain('id="btn-help"');
    expect(html).toContain('id="hint"');
  });
});

describe('help does not restate what the app already knows', () => {
  it('renders the concept notes themselves, not a copy of them', () => {
    const rows = conceptRows();
    expect(rows).toHaveLength(NOTES.length);
    // Identity of content, not merely the same count — a paraphrase here would be a second
    // description free to drift from the challenge track's.
    expect(rows.map((r) => r.text)).toEqual(NOTES.map((n) => n.text));
  });

  it('renders the real goal presets', () => {
    expect(goalRows().map((r) => r.term)).toEqual(PRESETS.map((p) => p.name));
    expect(goalRows().map((r) => r.text)).toEqual(PRESETS.map((p) => p.blurb));
  });

  it('renders the real task suite', () => {
    expect(taskRows().map((r) => r.term)).toEqual(TASKS.map((t) => t.name));
    expect(taskRows().map((r) => r.text)).toEqual(TASKS.map((t) => t.teaches));
  });
});

describe('the keymap is the only description of the keys', () => {
  it('matches every listed shortcut to a real event', () => {
    for (const s of LISTED_SHORTCUTS) {
      const event = s.useCode
        ? ({ code: s.key, key: ' ' } as KeyboardEvent)
        : ({ code: '', key: s.key } as KeyboardEvent);
      expect(shortcutFor(event), s.label).toEqual(s);
    }
  });

  it('is case-insensitive, so Shift does not break a shortcut', () => {
    expect(shortcutFor({ code: '', key: 'R' } as KeyboardEvent)?.key).toBe('r');
    expect(shortcutFor({ code: '', key: 'S' } as KeyboardEvent)?.key).toBe('s');
  });

  it('ignores keys it does not own', () => {
    expect(shortcutFor({ code: '', key: 'q' } as KeyboardEvent)).toBeNull();
    expect(shortcutFor({ code: '', key: 'Enter' } as KeyboardEvent)).toBeNull();
  });

  it('has no duplicate bindings', () => {
    const keys = SHORTCUTS.map((s) => s.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every listed key a sentence a beginner could act on', () => {
    for (const s of LISTED_SHORTCUTS) {
      expect(s.does.length, s.label).toBeGreaterThan(20);
      expect(s.does.endsWith('.'), s.label).toBe(true);
    }
  });

  it('documents the key that opens help', () => {
    expect(LISTED_SHORTCUTS.some((s) => s.key === '?')).toBe(true);
  });
});

describe('the help text itself', () => {
  it('has unique section ids and a title each', () => {
    const ids = HELP.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of HELP) expect(s.title.length, s.id).toBeGreaterThan(2);
  });

  it('starts by saying what the thing is', () => {
    // Ordering is content: a reader who opens help does not want the keyboard shortcuts first.
    expect(HELP[0]!.id).toBe('what');
    expect(HELP[1]!.id).toBe('first');
  });

  it('leaves no section empty', () => {
    for (const s of HELP) expect(s.blocks.length, s.id).toBeGreaterThan(0);
  });

  it('avoids jargon before it is introduced', () => {
    // The brief was "does not assume prior knowledge". These four words are the ones a reader
    // cannot look up from context, so each must be explained somewhere before the glossary —
    // and the glossary itself is the backstop.
    const glossary = HELP.find((s) => s.id === 'numbers')!;
    const terms = glossary.blocks.flatMap((b) => (b.kind === 'terms' ? b.items.map((i) => i.term) : []));
    for (const word of ['Fitness', 'Duty factor', 'Stride length', 'Diversity']) {
      expect(terms, word).toContain(word);
    }
  });
});

describe('emphasis', () => {
  it('marks text between a pair of asterisks', () => {
    expect(emphasisParts('the gait *you* control')).toEqual([
      { text: 'the gait ', em: false },
      { text: 'you', em: true },
      { text: ' control', em: false },
    ]);
  });

  it('leaves an unpaired marker as literal text', () => {
    // Otherwise one stray asterisk swallows the rest of the paragraph into an <em>.
    expect(emphasisParts('a * b')).toEqual([
      { text: 'a ', em: false },
      { text: ' b', em: false },
    ]);
  });

  it('passes plain prose through untouched', () => {
    expect(emphasisParts('nothing to see')).toEqual([{ text: 'nothing to see', em: false }]);
  });

  it('handles several pairs', () => {
    expect(emphasisParts('*a* and *b*').filter((p) => p.em).map((p) => p.text)).toEqual(['a', 'b']);
  });

  it('leaves no markers in what the reader sees', () => {
    // The guard that matters: every asterisk in the help copy must have been consumed as a
    // marker, or it shows up literally on screen — which is how this was found.
    const texts: string[] = [];
    for (const section of HELP) {
      for (const block of section.blocks) {
        if (block.kind === 'p') texts.push(block.text);
        if (block.kind === 'steps') texts.push(...block.items);
        if (block.kind === 'terms' || block.kind === 'panels') {
          texts.push(...block.items.map((i) => i.text));
        }
      }
    }
    for (const text of texts) {
      const rendered = emphasisParts(text).map((p) => p.text).join('');
      expect(rendered, text.slice(0, 40)).not.toContain('*');
    }
  });
});

describe('the per-panel ? control', () => {
  it('points every declared header at a panel help really describes', () => {
    const ids = new Set(referencedIds());
    for (const { header, id } of panelHeaders()) {
      expect(ids, `${header} → ${id}`).toContain(id);
    }
  });

  it('declares each header once', () => {
    const headers = panelHeaders().map((p) => p.header);
    expect(new Set(headers).size).toBe(headers.length);
  });

  it('names a header that exists somewhere in the app', () => {
    // Some headers are static in index.html and some are built by the panel that owns them —
    // the scorecard, the runs list, the body editor, the challenge track and the sliders all
    // create their own. Either way the id has to appear in the source, and this is what
    // catches a rename before the `?` silently stops appearing.
    const sources = [
      html,
      ...['ui/sliders.ts', 'ui/editor.ts', 'ui/scorecard.ts', 'net/panel.ts', 'challenges/track.ts']
        .map((f) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8')),
    ].join('\n');

    // Either idiom counts — `id="ph-chart"` in markup, or `head.id = 'ph-sliders'` in code.
    for (const { header } of panelHeaders()) {
      const found = sources.includes(`id="${header}"`) || sources.includes(`'${header}'`);
      expect(found, `${header} is set somewhere`).toBe(true);
    }
  });

  it('covers the panels a beginner opens first', () => {
    const covered = new Set(panelHeaders().map((p) => p.id));
    for (const id of ['sliders', 'chart', 'archive', 'scorecard']) {
      expect(covered, id).toContain(id);
    }
  });
});
