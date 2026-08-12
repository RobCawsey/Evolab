/**
 * One worker, dedicated to the task suite — slice 14.
 *
 * **A second instance of `island.worker.ts`, not a second worker file.** Vite bundles a worker
 * per entry, and `-compat` inlines Rapier's WASM into each bundle — Appendix A measured that at
 * about 1.5 MB. A separate entry would have added a third copy to the download to avoid one
 * `case` in a `switch`. Another instance of the same file costs a second WASM *instantiation*
 * in memory and nothing on the wire.
 *
 * Its own worker rather than an island's, because the suite takes about half a second and an
 * island answering it would stall its own search for that long. The pool is also built lazily,
 * so a gait can be scored before anything has been evolved — which is exactly when a reader is
 * most likely to want to.
 *
 * Created on first use and kept. Nothing here is on a critical path: if the worker never
 * answers, the panel says so and the rest of the app is untouched.
 */

import type { GaitParams, Morphology, TrialResult } from '@evolab/evolution';
import type { FromWorker, ToWorker } from './protocol.ts';

export interface SuiteRun {
  readonly results: Map<string, TrialResult[]>;
  /** Wall-clock milliseconds the worker spent running the trials. */
  readonly ms: number;
}

/** Nothing else in the app waits this long for anything; a suite that does has hung. */
const TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let nextRequest = 1;
const pending = new Map<number, (run: SuiteRun) => void>();
const failed = new Map<number, (reason: Error) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./island.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.type === 'scorecard') {
      const resolve = pending.get(message.requestId);
      pending.delete(message.requestId);
      failed.delete(message.requestId);
      resolve?.({ results: new Map(Object.entries(message.results)), ms: message.ms });
      return;
    }
    if (message.type === 'error') {
      // The suite worker runs one thing, so any error it reports belongs to whatever is in
      // flight. Rejecting all of them is right rather than lax: there is only ever one.
      for (const reject of failed.values()) reject(new Error(message.message));
      pending.clear();
      failed.clear();
    }
  };
  return worker;
}

/**
 * Score one gait. Rejects rather than throwing into the void, so the caller can say so on
 * screen — the same contract `api.ts` holds for the server.
 */
export function runScorecard(morphology: Morphology, gait: GaitParams): Promise<SuiteRun> {
  const requestId = nextRequest++;
  const target = ensureWorker();

  return new Promise<SuiteRun>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      failed.delete(requestId);
      reject(new Error('The task suite did not answer.'));
    }, TIMEOUT_MS);

    pending.set(requestId, (run) => {
      clearTimeout(timer);
      resolve(run);
    });
    failed.set(requestId, (reason) => {
      clearTimeout(timer);
      reject(reason);
    });

    const message: ToWorker = { type: 'scorecard', requestId, morphology, gait };
    target.postMessage(message);
  });
}

/** Only for tests and teardown; the app keeps its worker for the session. */
export function disposeScorecardWorker(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
  failed.clear();
}
