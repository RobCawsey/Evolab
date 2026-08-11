/**
 * The challenge track — Fig 9.2. The curriculum, expressed as work rather than as lessons.
 *
 * **Nothing is locked.** Cards past the learner's progress are dimmed as guidance, never
 * gated: §7's decision on freely switchable stages applies here too, and a reader who already
 * knows NSGA-II should be able to start at card 11. Dimming is a suggestion about order, not
 * a permission system.
 *
 * The panel holds no run state. It is handed a `Progress` and an outcome, and it hands back
 * "the learner opened this card" — `main.ts` owns everything else, the same arrangement the
 * gait panels and the archive use.
 */

import { renderAfterword } from './check.ts';
import { CHALLENGES } from './data.ts';
import { NOTES, noteById } from './notes.ts';
import { completed, understands, type Progress } from './progress.ts';
import type { Challenge, Outcome } from './types.ts';

export interface TrackHandlers {
  /** The learner picked a card. `main.ts` applies its setup and starts a run. */
  onOpen(challenge: Challenge): void;
  onDismissNote(conceptId: string): void;
}

export interface TrackPanel {
  update(progress: Progress, openId: string | null, outcome: Outcome | null, done: boolean): void;
}

export function createTrack(host: HTMLElement, handlers: TrackHandlers): TrackPanel {
  // The note sits **above** the list, not below it.
  //
  // §7 puts explanations in the right rail; that rail is full, so they live here instead. The
  // first version appended them under eleven cards, which put the note about 1,300 px down a
  // scrolling column — clicking a `?` appeared to do nothing at all. Above the list it is
  // always the thing that just changed.
  host.innerHTML = `
    <div class="ph">Challenges<span class="sp"></span><em id="ch-count">0 of 12 concepts</em></div>
    <div class="ch-dots" id="ch-dots"></div>
    <div class="ph" id="ch-note-head" hidden>Explanation<span class="sp"></span><em>what this means</em></div>
    <div class="ch-note" id="ch-note" hidden></div>
    <div class="ch-list" id="ch-list"></div>`;

  const el = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const list = el('ch-list');
  const noteHead = el('ch-note-head');
  const noteBox = el('ch-note');

  // Built once. Only classes and the afterword change afterwards, so opening a card does not
  // rebuild eleven DOM subtrees and lose the scroll position.
  const cards = new Map<string, { root: HTMLElement; after: HTMLElement; concepts: HTMLElement }>();

  let previousPhase = '';
  for (const [index, challenge] of CHALLENGES.entries()) {
    // A subhead whenever the phase changes. Eleven cards in a row read as eleven unrelated
    // tasks; grouped, they read as four ideas — which is what the ladder in §7 actually is.
    if (challenge.phase !== previousPhase) {
      const head = document.createElement('div');
      head.className = 'ch-phase';
      head.textContent = challenge.phase;
      list.append(head);
      previousPhase = challenge.phase;
    }

    const root = document.createElement('div');
    root.className = 'ch-card';

    const head = document.createElement('button');
    head.className = 'ch-head';
    head.innerHTML =
      `<span class="ch-n">${index + 1}</span>` +
      `<span class="ch-t">${challenge.title}</span>` +
      '<span class="ch-tick">✓</span>';
    head.addEventListener('click', () => handlers.onOpen(challenge));

    const brief = document.createElement('p');
    brief.className = 'ch-brief';
    brief.textContent = challenge.brief;

    const task = document.createElement('p');
    task.className = 'ch-task';
    task.textContent = challenge.task;

    // Concept chips carry the `?` — one affordance, everywhere (§7). No tooltips, no modals.
    const concepts = document.createElement('div');
    concepts.className = 'ch-concepts';

    const after = document.createElement('p');
    after.className = 'ch-after';
    after.hidden = true;

    root.append(head, brief, task, concepts, after);
    list.append(root);
    cards.set(challenge.id, { root, after, concepts });
  }

  function paintConcepts(challenge: Challenge, into: HTMLElement, progress: Progress): void {
    into.replaceChildren(
      ...challenge.teaches.map((id) => {
        const note = noteById(id);
        const chip = document.createElement('button');
        chip.className = `ch-chip${understands(progress, id) ? ' known' : ''}`;
        chip.textContent = note ? note.name : id;
        chip.title = 'What does this mean?';
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          showNote(id, progress);
        });
        return chip;
      }),
    );
  }

  function showNote(conceptId: string, progress: Progress): void {
    const note = noteById(conceptId);
    if (!note) return;
    noteHead.hidden = false;
    noteBox.hidden = false;
    noteBox.replaceChildren();

    const name = document.createElement('b');
    name.textContent = note.name;
    const text = document.createElement('p');
    text.textContent = note.text;

    const dismiss = document.createElement('button');
    dismiss.className = 'ghost wide';
    dismiss.textContent = 'I know this — stop offering it';
    dismiss.addEventListener('click', () => {
      handlers.onDismissNote(conceptId);
      noteHead.hidden = true;
      noteBox.hidden = true;
    });

    noteBox.append(name, text);
    // Dismissal is permanent per concept (§7), so it is only offered once.
    if (!progress.dismissed.includes(conceptId)) noteBox.append(dismiss);

    // Being above the list is not enough on its own: a chip clicked on card 8 is a long way
    // below the note it opens. Scrolling to it is what makes the `?` feel like it did
    // something, which is the whole job of a one-affordance explanation layer.
    noteHead.scrollIntoView({ block: 'nearest' });
  }

  /**
   * The concept strip: one dot per concept, in the order the ladder introduces it.
   *
   * §7 says the panel answers *what do I understand now*, and eleven card titles do not
   * answer that at a glance — they answer *what have I done*. Twelve dots do, in about
   * twenty pixels, and they stay put while the list scrolls.
   *
   * Ordered by first appearance in the cards rather than by `NOTES` order, so the strip is
   * the ladder rather than an alphabet.
   */
  const conceptOrder = [...new Set(CHALLENGES.flatMap((c) => c.teaches))];
  const dots = new Map<string, HTMLElement>();
  for (const id of conceptOrder) {
    const dot = document.createElement('button');
    dot.className = 'ch-dot';
    dot.title = noteById(id)?.name ?? id;
    dot.addEventListener('click', () => showNote(id, lastProgress));
    el('ch-dots').append(dot);
    dots.set(id, dot);
  }

  // `showNote` needs the current record and the dots are wired before `update` first runs.
  let lastProgress: Progress = { concepts: [], cards: [], dismissed: [] };
  /** Only scroll when the open card actually changes, not on every repaint. */
  let scrolledTo: string | null = null;

  return {
    update(progress, openId, outcome, done): void {
      lastProgress = progress;
      el('ch-count').textContent = `${progress.concepts.length} of ${NOTES.length} concepts`;
      for (const [id, dot] of dots) dot.classList.toggle('known', understands(progress, id));

      // The frontier is the first card not yet completed. Everything past it is dimmed as a
      // suggestion of where to go next — and stays clickable, which is the whole point.
      const frontier = CHALLENGES.findIndex((c) => !completed(progress, c.id));

      for (const [index, challenge] of CHALLENGES.entries()) {
        const card = cards.get(challenge.id)!;
        const isOpen = challenge.id === openId;
        const isDone = completed(progress, challenge.id);
        card.root.classList.toggle('open', isOpen);
        card.root.classList.toggle('done', isDone);
        // Dim what is further along than the frontier — but never the card in front of the
        // learner, and never one they have already finished. Fading completed work reads as
        // "this no longer counts", which is the opposite of what a progress panel is for.
        card.root.classList.toggle(
          'ahead',
          frontier >= 0 && index > frontier && !isOpen && !isDone,
        );
        paintConcepts(challenge, card.concepts, progress);

        // The afterword appears only on the open card, only once its run has finished, and
        // it is written against the numbers that run actually produced.
        const show = isOpen && done && outcome !== null;
        card.after.hidden = !show;
        if (show) card.after.textContent = renderAfterword(challenge.afterword, outcome);
      }

      // Bring the newly opened card into view. Only when it changes: doing it on every
      // repaint would yank the list back every time a run reported a generation.
      if (openId !== null && openId !== scrolledTo) {
        cards.get(openId)?.root.scrollIntoView({ block: 'nearest' });
      }
      scrolledTo = openId;
    },
  };
}
