/**
 * The scorecard panel — slice 14, Fig 9.7's right-hand column.
 *
 * Six rows, a badge each, and one composite. The panel renders a `Scorecard`; it does not run
 * anything and does not know a worker exists, so the whole of it is `replaceChildren` on plain
 * data and the interesting half is testable without a DOM.
 *
 * **Explicit and on demand.** Slice 10's rule was that nothing in it re-runs the simulation,
 * because a panel that simulates makes *looking* at a gait cost as much as evolving one. This
 * slice is the opposite — running new trials is the whole feature — so the rule that replaces
 * it is that a scorecard happens because somebody pressed a button, never because a panel
 * became visible.
 */

import { METRIC_UNITS, TASK_SEEDS, type Badge, type Scorecard, type TaskScore } from '@evolab/evolution';

const LABEL: Record<Badge, string> = {
  gold: 'gold',
  silver: 'silver',
  bronze: 'bronze',
  fail: 'fail',
};

/** How a task's median reads, in its own units. */
export function formatValue(score: TaskScore): string {
  const unit = METRIC_UNITS[score.task.metric];
  // Effort per metre is stored negated so that higher is better everywhere. The reader wants
  // the number the robot actually spent, so it is flipped back for display only.
  const shown = score.task.metric === 'travelPerMetre' ? -score.median : score.median;
  return `${shown.toFixed(2)} ${unit}`;
}

/**
 * The one line under the card, and the only place the panel says anything in words.
 *
 * It names **the task holding the composite down**, because that is the actionable half of
 * §6's minimum-in-every-task rule: a reader who is told "bronze" learns nothing, and one who is
 * told "bronze, because it falls on the steps every time" knows what to fix.
 */
export function verdictOf(card: Scorecard): string {
  if (card.tasks.length === 0) return '';
  const worst = card.tasks.reduce((a, b) =>
    (b.badge === card.overall && a.badge !== card.overall ? b : a));
  if (card.overall === 'gold') {
    return `Gold overall — every task cleared. ${card.tasks.length} of ${card.tasks.length} passed.`;
  }
  const why = worst.fell * 2 > TASK_SEEDS.length
    ? `it falls on ${worst.task.name} in ${worst.fell} of ${TASK_SEEDS.length} runs`
    : `${worst.task.name} scores ${formatValue(worst)}`;
  return `${LABEL[card.overall]} overall, because ${why}. The badge is the worst task, `
    + 'not the average — speed cannot buy it.';
}

export interface ScorecardPanel {
  /** `null` clears the card back to its resting state. */
  show(card: Scorecard | null, ms: number): void;
  busy(on: boolean): void;
  note(text: string): void;
  /** Whether the Run button is offered at all — there must be a gait to test. */
  enable(on: boolean): void;
}

export function createScorecardPanel(
  host: HTMLElement,
  onRun: () => void,
): ScorecardPanel {
  host.innerHTML = `
    <div class="ph explorer-only">Scorecard<span class="sp"></span><em id="sc-overall"></em></div>
    <div class="stats explorer-only">
      <button id="sc-run" class="wide" disabled>Test this gait</button>
    </div>
    <div class="sc-rows explorer-only" id="sc-rows"></div>
    <div class="note explorer-only" id="sc-note">
      Six tasks, five seeds each, on ground the gait was never evolved on. Evolution scores a
      robot on four seconds of flat ground; this is what that is worth everywhere else.
    </div>`;

  const el = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  el('sc-run').addEventListener('click', onRun);

  return {
    show(card, ms): void {
      const rows = el('sc-rows');
      const overall = el('sc-overall');

      if (card === null) {
        rows.replaceChildren();
        overall.textContent = '';
        return;
      }

      overall.textContent = `${LABEL[card.overall]} · ${card.passed}/${card.tasks.length}`;
      overall.className = `bg-${card.overall}`;

      rows.replaceChildren(...card.tasks.map((score) => {
        const row = document.createElement('div');
        row.className = 'sc-row';
        // A task's own words, so hovering says what failing it means rather than repeating it.
        row.title = `${score.task.name} — ${score.task.teaches}`;

        const name = document.createElement('span');
        name.className = 'sc-name';
        name.textContent = score.task.name;

        const value = document.createElement('span');
        value.className = 'sc-val mono';
        value.textContent = formatValue(score);

        const badge = document.createElement('span');
        badge.className = `sc-badge bg-${score.badge}`;
        badge.textContent = LABEL[score.badge];

        // The spread is the part §6 cares about: a gait that clears the steps once in five is
        // a gait that does not clear the steps.
        const spread = document.createElement('span');
        spread.className = 'sc-spread mono';
        spread.textContent = score.fell > 0 ? `fell ${score.fell}/${TASK_SEEDS.length}` : '';

        row.append(name, value, spread, badge);
        return row;
      }));

      el('sc-note').textContent =
        `${card.tasks.length} tasks × ${TASK_SEEDS.length} seeds in ${(ms / 1000).toFixed(2)} s. `
        + verdictOf(card);
    },

    busy(on): void {
      const run = el<HTMLButtonElement>('sc-run');
      run.disabled = on;
      run.textContent = on ? 'Testing…' : 'Test this gait';
    },

    note(text): void {
      el('sc-note').textContent = text;
    },

    enable(on): void {
      el<HTMLButtonElement>('sc-run').disabled = !on;
    },
  };
}
