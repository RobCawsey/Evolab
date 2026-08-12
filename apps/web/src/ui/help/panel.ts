/**
 * The help overlay — slice 15.
 *
 * Full screen, like the stepper, and for the same reason: this is something you read rather
 * than glance at, and a drawer 300 px wide turns eight sections of prose into a scroll tunnel.
 * Contents down the left, the text on the right, and the whole thing closes on `Escape`, on the
 * button, or on clicking outside the reading column.
 *
 * **No tour, no tooltips, no pointer hijacking.** §7 of the design document is explicit that the
 * temptation with an educational build is to wrap the real application in a layer of
 * explanation and call it taught. Help is a place you go, deliberately, and it does not follow
 * you around when you leave.
 *
 * Everything it draws comes from `content.ts`, and the parts of that which duplicate something
 * the app already knows are generated rather than typed.
 */

import {
  conceptRows,
  goalRows,
  HELP,
  taskRows,
  type HelpBlock,
  type HelpSection,
} from './content.ts';
import { LISTED_SHORTCUTS } from '../keymap.ts';

export interface HelpPanel {
  open(sectionId?: string): void;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * `*emphasis*` → `<em>`, and nothing else.
 *
 * The contrast carries meaning in these sentences — *the gait you control*, *every kind of
 * walk*, *the worst task, not the average* — so flattening them to lose the markers would cost
 * the reader something real.
 *
 * **Builds nodes; never touches `innerHTML`.** A one-rule renderer is worth having only if it
 * cannot become a general HTML injection point, and text nodes cannot. An unpaired `*` renders
 * as itself rather than swallowing the rest of the paragraph.
 */
export function emphasise(text: string, into: HTMLElement): HTMLElement {
  for (const part of emphasisParts(text)) {
    if (!part.em) {
      into.append(document.createTextNode(part.text));
      continue;
    }
    const em = document.createElement('em');
    em.textContent = part.text;
    into.append(em);
  }
  return into;
}

export interface EmphasisPart {
  readonly text: string;
  readonly em: boolean;
}

/**
 * The parsing half, split out so it tests in Node without a DOM — the same reason
 * `render/three/bodies.ts` computes its arithmetic away from Three.
 */
export function emphasisParts(text: string): readonly EmphasisPart[] {
  const chunks = text.split('*');
  const parts: EmphasisPart[] = [];
  chunks.forEach((chunk, i) => {
    if (chunk === '') return;
    // Odd indices sit between a pair of markers — unless this is the final chunk, in which case
    // its opening marker was never closed and the text is literal.
    parts.push({ text: chunk, em: i % 2 === 1 && i < chunks.length - 1 });
  });
  return parts;
}

function termList(items: readonly { readonly term: string; readonly text: string }[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'hp-terms';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'hp-term';
    const dt = document.createElement('h4');
    dt.textContent = item.term;
    const dd = emphasise(item.text, document.createElement('p'));
    row.append(dt, dd);
    wrap.append(row);
  }
  return wrap;
}

function renderBlock(block: HelpBlock): HTMLElement {
  switch (block.kind) {
    case 'p':
      return emphasise(block.text, document.createElement('p'));

    case 'steps': {
      const ol = document.createElement('ol');
      ol.className = 'hp-steps';
      for (const item of block.items) ol.append(emphasise(item, document.createElement('li')));
      return ol;
    }

    case 'terms':
      return termList(block.items);

    case 'panels':
      // Rendered as terms, but each row carries the id it describes — which is the thing
      // `help.test.ts` checks against `index.html`.
      return termList(block.items.map((i) => ({ term: i.name, text: i.text })));

    case 'concepts':
      return termList(conceptRows());

    case 'goals':
      return termList(goalRows());

    case 'tasks':
      return termList(taskRows());

    case 'keys': {
      const wrap = document.createElement('div');
      wrap.className = 'hp-keys';
      for (const s of LISTED_SHORTCUTS) {
        const row = document.createElement('div');
        row.className = 'hp-key';
        const kbd = document.createElement('kbd');
        kbd.textContent = s.label;
        const what = document.createElement('span');
        what.textContent = s.does;
        row.append(kbd, what);
        wrap.append(row);
      }
      return wrap;
    }
  }
}

function renderSection(section: HelpSection): HTMLElement {
  const el = document.createElement('section');
  el.className = 'hp-section';
  el.id = `hp-${section.id}`;
  const h = document.createElement('h3');
  h.textContent = section.title;
  el.append(h, ...section.blocks.map(renderBlock));
  return el;
}

export function createHelp(host: HTMLElement): HelpPanel {
  const root = document.createElement('div');
  root.className = 'stepper hp';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Help');

  root.innerHTML = `
    <header>
      <strong>Help</strong>
      <span class="chip">no prior knowledge assumed</span>
      <span class="spacer" style="flex:1"></span>
      <button id="hp-close">Close</button>
    </header>
    <div class="hp-body">
      <nav class="hp-nav" id="hp-nav"></nav>
      <div class="hp-read" id="hp-read"></div>
    </div>`;

  host.append(root);

  const nav = root.querySelector<HTMLElement>('#hp-nav')!;
  const read = root.querySelector<HTMLElement>('#hp-read')!;

  read.append(...HELP.map(renderSection));

  nav.append(...HELP.map((section) => {
    const link = document.createElement('button');
    link.className = 'hp-link';
    link.textContent = section.title;
    link.addEventListener('click', () => {
      root.querySelector(`#hp-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return link;
  }));

  let open = false;

  const panel: HelpPanel = {
    open(sectionId?: string): void {
      open = true;
      root.hidden = false;
      // Always land at the top of the requested section rather than wherever it was left, so
      // opening help twice gives the same answer twice.
      const target = sectionId ? root.querySelector(`#hp-${sectionId}`) : null;
      if (target) target.scrollIntoView({ block: 'start' });
      else read.scrollTop = 0;
      root.querySelector<HTMLButtonElement>('#hp-close')!.focus();
    },
    close(): void {
      open = false;
      root.hidden = true;
    },
    get isOpen(): boolean {
      return open;
    },
  };

  root.querySelector('#hp-close')!.addEventListener('click', () => panel.close());
  // Clicking the background closes; clicking the text does not, so selecting a sentence is safe.
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) panel.close();
  });

  return panel;
}
