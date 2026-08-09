/// <reference lib="webworker" />
/**
 * One island, running flat out on its own thread.
 *
 * Unlike the main thread, a worker has no frame to yield to, so it can run whole
 * generations back to back — which is the entire point of slice 4. What it does have to
 * yield for is its own message queue: a tight synchronous loop would never see `pause` or
 * `immigrate`, because those handlers only run when the worker returns to its event loop.
 * Hence the `breathe()` between generations.
 */

import {
  createIsland,
  emigrants,
  immigrate,
  stepGeneration,
  type Genome,
  type Island,
} from '@evolab/evolution';
import { initPhysics, makeEvaluator } from '@evolab/sim';
import type { FromWorker, IslandSetup, ToWorker } from './protocol.ts';
import { transferable } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let island: Island | null = null;
let setup: IslandSetup | null = null;
let evaluate: ReturnType<typeof makeEvaluator> | null = null;
let running = false;
let target = 0;
/** Migrants that arrived while a generation was in flight, applied at the next boundary. */
let mailbox: Genome[] = [];

function post(message: FromWorker, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) ctx.postMessage(message, transfer);
  else ctx.postMessage(message);
}

/**
 * Return to the event loop long enough for pending messages to be delivered.
 *
 * `await Promise.resolve()` is not enough — microtasks drain without ever letting a
 * `message` event through. It has to be a macrotask.
 */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loop(): Promise<void> {
  if (!island || !evaluate || !setup) return;

  while (running && island.generation < target) {
    // Migrants are applied at a generation boundary rather than the moment they land, so a
    // generation is never modified halfway through being evaluated.
    if (mailbox.length > 0) {
      immigrate(island, mailbox);
      mailbox = [];
    }

    const started = performance.now();
    let summary;
    try {
      summary = stepGeneration(island, evaluate);
    } catch (err) {
      running = false;
      post({ type: 'error', islandId: setup.islandId, message: String(err) });
      return;
    }
    const evalMs = performance.now() - started;

    post({ type: 'generation', islandId: setup.islandId, summary, evalMs });

    if (setup.migrationInterval > 0 && island.generation % setup.migrationInterval === 0) {
      const genomes = emigrants(island, setup.migrantCount);
      post({ type: 'emigrants', islandId: setup.islandId, genomes }, transferable(genomes));
    }

    await breathe();
  }

  running = false;
  post({ type: 'paused', islandId: setup.islandId, generation: island.generation });
}

ctx.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;

  switch (message.type) {
    case 'init': {
      setup = message.setup;
      void (async () => {
        const started = performance.now();
        // Rapier's WASM is per-worker; linear memory is not shared between threads.
        await initPhysics();
        island = createIsland(setup!.islandId, setup!.seed, setup!.config);
        evaluate = makeEvaluator(setup!.morphology, { seconds: setup!.trialSeconds });
        post({ type: 'ready', islandId: setup!.islandId, initMs: performance.now() - started });
      })();
      return;
    }

    case 'run': {
      target = message.untilGeneration;
      if (running || !island) return;
      running = true;
      void loop();
      return;
    }

    case 'pause': {
      running = false;
      return;
    }

    case 'immigrate': {
      // The transferred buffers now belong to this worker, so they can be kept as-is.
      for (const g of message.genomes) mailbox.push(g);
      return;
    }
  }
};
