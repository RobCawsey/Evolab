/**
 * The two pieces of interface the server earns — slice 12.
 *
 * A saved-runs panel, and the failure indicator of Fig 9.9. Both hold the rule the slice
 * turns on: **nothing here is on a critical path**, nothing blocks, and with no server at all
 * the panel says so once and the app carries on exactly as it did for eleven slices.
 */

import { onFailuresChanged, recentFailures, type ApiError } from './api.ts';
import type { RunSummary } from './types.ts';

export interface RunsHandlers {
  onSave(): void;
  onOpen(id: string): void;
  onShare(id: string): void;
}

export interface RunsPanel {
  /** `null` means the list has not been fetched, or the fetch failed. */
  show(runs: readonly RunSummary[] | null, busy: boolean, canSave: boolean): void;
  note(text: string): void;
}

export function createRunsPanel(host: HTMLElement, handlers: RunsHandlers): RunsPanel {
  host.innerHTML = `
    <div class="ph" id="ph-runs">Saved runs<span class="sp"></span><em id="rn-count"></em></div>
    <div class="stats">
      <button id="rn-save" class="wide" disabled>Save this run</button>
      <p class="gd-note" id="rn-note">
        Runs are kept in the browser until you save one. Saving is optional and never blocks
        anything — with no server running, everything here still works.
      </p>
    </div>
    <div class="rn-list" id="rn-list"></div>`;

  const el = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  el('rn-save').addEventListener('click', () => handlers.onSave());

  return {
    show(runs, busy, canSave): void {
      const save = el<HTMLButtonElement>('rn-save');
      save.disabled = busy || !canSave;
      save.textContent = busy ? 'Saving…' : 'Save this run';

      el('rn-count').textContent = runs === null ? '' : `${runs.length}`;
      const list = el('rn-list');

      if (runs === null || runs.length === 0) {
        list.replaceChildren();
        return;
      }

      list.replaceChildren(...runs.map((run) => {
        const row = document.createElement('div');
        row.className = 'rn-row';

        const open = document.createElement('button');
        open.className = 'rn-open';
        open.innerHTML =
          `<span class="rn-t"></span><span class="rn-m mono"></span>`;
        // textContent, not innerHTML — a title is user input and goes nowhere near a parser.
        open.querySelector('.rn-t')!.textContent = run.title;
        open.querySelector('.rn-m')!.textContent =
          `${run.championDistance.toFixed(1)} m · ${run.generations} gens`;
        open.addEventListener('click', () => handlers.onOpen(run.id));

        const share = document.createElement('button');
        share.className = 'rn-share';
        share.textContent = run.shareToken ? 'Copy link' : 'Share';
        share.title = run.shareToken ? 'Copy the read-only link' : 'Make a read-only link';
        share.addEventListener('click', (e) => {
          e.stopPropagation();
          handlers.onShare(run.id);
        });

        row.append(open, share);
        return row;
      }));
    },

    note(text: string): void {
      el('rn-note').textContent = text;
    },
  };
}

/* ---------------- the failure indicator — Fig 9.9 ---------------- */

/**
 * One dot, and it is **absent** when there is nothing to report.
 *
 * A working server looks exactly like no server: no badge, no tick, no "connected" pill.
 * Anything permanently on screen would imply the server matters more than it does, and it
 * does not — evolution never leaves the browser.
 *
 * Amber rather than red, because red already means *the robot fell*, which is a fact about
 * the simulation. A failed upload is not the same kind of news.
 */
export function createFailureIndicator(host: HTMLElement): { dispose(): void } {
  const dot = document.createElement('button');
  dot.id = 'btn-failures';
  dot.className = 'err-dot';
  dot.type = 'button';
  dot.hidden = true;

  const popup = document.createElement('div');
  popup.className = 'err-pop';
  popup.hidden = true;

  host.append(dot, popup);

  const close = () => { popup.hidden = true; };

  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.hidden = !popup.hidden;
    if (!popup.hidden) render();
  });
  document.addEventListener('click', (e) => {
    if (!popup.hidden && !popup.contains(e.target as Node) && e.target !== dot) close();
  });

  function line(error: ApiError): HTMLElement {
    const row = document.createElement('div');
    row.className = 'err-row';

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.gap = '8px';
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = error.code;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = new Date(error.at).toTimeString().slice(0, 8);
    head.append(code, when);

    const message = document.createElement('p');
    message.textContent = error.message;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${error.status} · ${error.traceId ? `trace ${error.traceId}` : 'no trace'}`;

    row.append(head, message, meta);
    return row;
  }

  function render(): void {
    const failures = recentFailures();
    popup.replaceChildren();

    const head = document.createElement('div');
    head.className = 'ph';
    head.style.height = '24px';
    head.style.padding = '0 2px';
    head.innerHTML = `Recent failures<span class="sp"></span><em>${failures.length}</em>`;
    popup.append(head, ...failures.map(line));

    // The actual reporting affordance, and the reason traceId is carried at all: one click
    // gets a report that pairs with a server log line.
    const copy = document.createElement('button');
    copy.className = 'wide ghost';
    copy.textContent = 'Copy details';
    copy.addEventListener('click', () => {
      const report = failures
        .map((f) => `${new Date(f.at).toISOString()} ${f.code} ${f.status} ${f.traceId ?? '-'} ${f.message}`)
        .join('\n');
      void navigator.clipboard?.writeText(report).catch(() => {
        // Clipboard permission is not something to raise an error about inside the error
        // reporter. If it fails, the text is still on screen to read.
      });
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy details'; }, 1200);
    });
    popup.append(copy);
  }

  function refresh(): void {
    const any = recentFailures().length > 0;
    dot.hidden = !any;
    dot.title = `${recentFailures().length} recent failure(s)`;
    if (!any) close();
    else if (!popup.hidden) render();
  }

  const off = onFailuresChanged(refresh);
  refresh();
  return { dispose: off };
}
