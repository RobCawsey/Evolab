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
  host.innerHTML = `
    <div class="ph">Challenges<span class="sp"></span><em id="ch-count">0 of 12 concepts</em></div>
    <div class="ch-list" id="ch-list"></div>
    <div class="ph" id="ch-note-head" hidden>Explanation<span class="sp"></span><em>what this means</em></div>
    <div class="ch-note" id="ch-note" hidden></div>`;

  const el = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const list = el('ch-list');
  const noteHead = el('ch-note-head');
  const noteBox = el('ch-note');

  // Built once. Only classes and the afterword change afterwards, so opening a card does not
  // rebuild eleven DOM subtrees and lose the scroll position.
  const cards = new Map<string, { root: HTMLElement; after: HTMLElement; concepts: HTMLElement }>();

  for (const [index, challenge] of CHALLENGES.entries()) {
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
  }

  return {
    update(progress, openId, outcome, done): void {
      el('ch-count').textContent = `${progress.concepts.length} of ${NOTES.length} concepts`;

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
    },
  };
}
