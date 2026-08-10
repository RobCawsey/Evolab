/**
 * The generation stepper — the teaching screen.
 *
 * It drives `generation(island, evaluate, { trace: true })`, which is the same function the
 * workers drain at full speed. Not a simulation of the algorithm for illustration: the real
 * one, paused between operators. A test asserts the traced and untraced paths produce
 * identical runs, because the moment that stops being true this screen becomes a lie.
 */

import {
  GENE_NAMES,
  createIsland,
  generation,
  type Genome,
  type Island,
  type Morphology,
  type Stage,
} from '@evolab/evolution';
import { makeEvaluator } from '@evolab/sim';
import { crossoverProvenance, drawStrip, mutationProvenance, type Provenance } from '../render/genes.ts';
import { EXPLANATIONS, STAGE_ORDER } from './explanations.ts';

export interface StepperOptions {
  /**
   * Deliberately smaller and shorter than a real run. The evaluate stage is synchronous —
   * it is one click, and the whole population is scored before the generator yields again —
   * so 12 genomes at 3 s costs about 110 ms rather than the 300 ms a full run would.
   */
  readonly population?: number;
  readonly trialSeconds?: number;
  readonly seed?: number;
}

export interface Stepper {
  open(): void;
  close(): void;
  /** Point the stepper at a different body. Discards the generation in progress. */
  retarget(morph: Morphology): void;
  readonly isOpen: boolean;
}

export function createStepper(initialMorph: Morphology, opts: StepperOptions = {}): Stepper {
  const population = opts.population ?? 12;
  const trialSeconds = opts.trialSeconds ?? 3;
  const seed = opts.seed ?? 4417;

  let morph = initialMorph;
  let evaluate = makeEvaluator(morph, { seconds: trialSeconds });
  let island: Island = createIsland(0, seed, { size: population, trialSeconds });
  let iterator = generation(island, evaluate, { trace: true });
  let current: Stage | null = null;
  let finished = false;
  let open = false;

  /* ---------------- DOM ---------------- */

  const root = document.createElement('div');
  root.className = 'stepper';
  root.hidden = true;
  root.innerHTML = `
    <header>
      <span class="brand">Evo<em>lab</em></span>
      <span class="chip">stepper</span>
      <button id="st-step" class="pri">Step →</button>
      <button id="st-gen">Finish generation</button>
      <button id="st-reset">Reset</button>
      <span class="spacer"></span>
      <span class="hint" id="st-where">generation 0 · not started</span>
      <button id="st-close">Close</button>
    </header>
    <div class="st-body">
      <aside class="st-stages">
        <div class="ph">One generation</div>
        <div id="st-list"></div>
        <div class="ph">Island</div>
        <div class="stats">
          <div class="kv"><span>population</span><b>${population}</b></div>
          <div class="kv"><span>genome length</span><b>${GENE_NAMES.length}</b></div>
          <div class="kv"><span>tournament</span><b>3</b></div>
          <div class="kv"><span>elites</span><b>2</b></div>
          <div class="kv"><span>trial</span><b>${trialSeconds}s</b></div>
        </div>
      </aside>
      <section class="st-detail">
        <div class="ph" id="st-title">Press Step to begin</div>
        <div id="st-content"></div>
      </section>
      <aside class="st-explain">
        <div class="ph">What is happening<span class="sp"></span><em id="st-concept"></em></div>
        <div id="st-what" class="prose"></div>
        <div class="ph">What to look at</div>
        <div id="st-read" class="prose dim"></div>
      </aside>
    </div>`;
  document.body.append(root);

  const el = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const list = el('st-list');
  const content = el('st-content');

  /* ---------------- stage list ---------------- */

  for (const stage of STAGE_ORDER) {
    const row = document.createElement('div');
    row.className = 'st-stage';
    row.dataset['stage'] = stage;
    row.innerHTML =
      `<b>${EXPLANATIONS[stage].title}</b><span>${EXPLANATIONS[stage].concept}</span>`;
    list.append(row);
  }

  function paintList(): void {
    const active = current?.stage;
    const activeIndex = active ? STAGE_ORDER.indexOf(active) : -1;
    list.querySelectorAll<HTMLElement>('.st-stage').forEach((row, i) => {
      row.classList.toggle('on', i === activeIndex);
      row.classList.toggle('done', activeIndex >= 0 && i < activeIndex);
    });
  }

  /* ---------------- strips ---------------- */

  function strip(
    label: string,
    genome: Genome,
    provenance?: readonly Provenance[],
    note?: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'st-strip';

    const name = document.createElement('span');
    name.className = 'st-label';
    name.textContent = label;

    const canvas = document.createElement('canvas');
    canvas.className = 'st-canvas';
    canvas.height = 22;

    const tail = document.createElement('span');
    tail.className = 'st-note';
    tail.textContent = note ?? '';

    row.append(name, canvas, tail);

    // Sized after layout, so the canvas matches its CSS width rather than guessing.
    requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth || 300;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(22 * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, 22);
      const cell = drawStrip(ctx, genome, {
        x: 0, y: 2, width, height: 18,
        ...(provenance ? { provenance } : {}),
      });
      // Hover a cell to name the gene it holds.
      canvas.onmousemove = (e) => {
        const i = Math.floor(e.offsetX / (cell + 1));
        canvas.title = i >= 0 && i < genome.length
          ? `${GENE_NAMES[i]} = ${genome[i]!.toFixed(3)}`
          : '';
      };
    });
    return row;
  }

  function fitnessRow(index: number, fitness: number, max: number, mark?: string): HTMLElement {
    const row = document.createElement('div');
    row.className = `st-fit${mark ? ` ${mark}` : ''}`;
    row.innerHTML =
      `<span class="st-label">#${String(index).padStart(2, '0')}</span>` +
      `<i style="width:${Math.max(1, (fitness / (max || 1)) * 100)}%"></i>` +
      `<b>${fitness.toFixed(3)}</b>` +
      (mark ? `<u>${mark}</u>` : '<u></u>');
    return row;
  }

  function heading(text: string): HTMLElement {
    const h = document.createElement('div');
    h.className = 'st-sub';
    h.textContent = text;
    return h;
  }

  /* ---------------- stage rendering ---------------- */

  function render(): void {
    content.replaceChildren();
    paintList();

    if (!current) {
      el('st-title').textContent = finished ? 'Generation complete' : 'Press Step to begin';
      el('st-what').textContent = '';
      el('st-read').textContent = '';
      el('st-concept').textContent = '';
      return;
    }

    // Captured into a const so the discriminated-union narrowing survives into the
    // callbacks below — a mutable module-scoped binding loses it at every closure.
    const stage = current;
    const info = EXPLANATIONS[stage.stage];
    el('st-title').textContent = info.title;
    el('st-what').textContent = info.what;
    el('st-read').textContent = info.read;
    el('st-concept').textContent = info.concept;

    switch (stage.stage) {
      case 'population': {
        content.append(heading(`${stage.size} genomes · ${stage.pending} need a trial`));
        island.population.forEach((ind, i) => {
          content.append(strip(`#${String(i).padStart(2, '0')}`, ind.genes, undefined,
            ind.result === null ? 'pending' : ind.fitness.toFixed(3)));
        });
        break;
      }

      case 'evaluate': {
        const max = Math.max(...stage.fitnesses, 0.001);
        content.append(heading(`${stage.evaluations} trials run · ranked best first`));
        stage.ranked.forEach((index, rank) => {
          content.append(fitnessRow(index, stage.fitnesses[index]!, max,
            rank < 2 ? 'elite' : undefined));
        });
        break;
      }

      case 'select': {
        const fitnesses = island.population.map((i) => i.fitness);
        const max = Math.max(...fitnesses, 0.001);
        stage.tournaments.forEach((t, k) => {
          content.append(heading(`Tournament ${k + 1} — three drawn, fittest wins`));
          for (const index of t.drawn) {
            content.append(fitnessRow(index, fitnesses[index]!, max,
              index === t.winner ? 'winner' : 'discarded'));
          }
          content.append(strip(`parent ${k === 0 ? 'A' : 'B'}`, island.population[t.winner]!.genes));
        });
        break;
      }

      case 'crossover': {
        const t = stage.trace;
        const copied = t.blended.filter((b) => !b).length;
        content.append(heading(
          `${t.blended.length - copied} genes blended, ${copied} copied straight through`));
        content.append(strip(`parent A #${String(t.parents[0]).padStart(2, '0')}`, t.a));
        content.append(strip(`parent B #${String(t.parents[1]).padStart(2, '0')}`, t.b));
        content.append(heading('Children'));
        content.append(strip('child 1', t.children[0], crossoverProvenance(t.blended, 0)));
        content.append(strip('child 2', t.children[1], crossoverProvenance(t.blended, 1)));
        break;
      }

      case 'mutate': {
        const total = stage.changes.reduce((n, c) => n + c.length, 0);
        content.append(heading(
          total === 0 ? 'No genes changed this time' : `${total} gene${total === 1 ? '' : 's'} moved`));
        stage.children.forEach((child, k) => {
          const changes = stage.changes[k] ?? [];
          content.append(strip(`child ${k + 1}`, child,
            mutationProvenance([], changes, child.length)));
          for (const c of changes) {
            const line = document.createElement('div');
            line.className = 'kv';
            line.innerHTML =
              `<span>${GENE_NAMES[c.gene]}</span>` +
              `<b class="am">${c.from.toFixed(3)} → ${c.to.toFixed(3)}</b>`;
            content.append(line);
          }
        });
        break;
      }

      case 'replace': {
        const s = stage.summary;
        content.append(heading('The next generation is ready'));
        for (const [label, value] of [
          ['best fitness', s.best.toFixed(4)],
          ['mean', s.mean.toFixed(4)],
          ['worst', s.worst.toFixed(4)],
          ['diversity', s.diversity.toFixed(4)],
          ['trials run', String(s.evaluations)],
        ] as const) {
          const row = document.createElement('div');
          row.className = 'kv';
          row.innerHTML = `<span>${label}</span><b>${value}</b>`;
          content.append(row);
        }
        content.append(heading('Champion of this generation'));
        content.append(strip('best', s.bestGenome));
        break;
      }
    }
  }

  /* ---------------- driving ---------------- */

  function where(): void {
    const pair = current && 'pair' in current ? ` · child pair ${current.pair + 1}` : '';
    el('st-where').textContent = finished
      ? `generation ${island.generation} · complete`
      : `generation ${island.generation}${pair}`;
  }

  function step(): void {
    if (finished) return startGeneration();
    const next = iterator.next();
    if (next.done) {
      current = null;
      finished = true;
    } else {
      current = next.value;
    }
    render();
    where();
  }

  function startGeneration(): void {
    iterator = generation(island, evaluate, { trace: true });
    finished = false;
    current = null;
    step();
  }

  /**
   * Run to the end of this generation and stop *on* the summary rather than past it.
   *
   * Draining all the way would land on "generation complete", which is a blank screen —
   * the replace stage carries the numbers worth reading, so that is where it stops.
   */
  function finishGeneration(): void {
    let guard = 0;
    while (!finished && current?.stage !== 'replace' && guard++ < 5000) step();
  }

  function reset(): void {
    island = createIsland(0, seed, { size: population, trialSeconds });
    iterator = generation(island, evaluate, { trace: true });
    current = null;
    finished = false;
    render();
    where();
  }

  el('st-step').addEventListener('click', step);
  el('st-gen').addEventListener('click', finishGeneration);
  el('st-reset').addEventListener('click', reset);
  el('st-close').addEventListener('click', () => api.close());

  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') api.close();
    if (e.key === 'ArrowRight' || e.code === 'Space') {
      e.preventDefault();
      step();
    }
  };
  window.addEventListener('keydown', onKey);

  const api: Stepper = {
    open(): void {
      open = true;
      root.hidden = false;
      if (!current && !finished) render();
      where();
    },
    close(): void {
      open = false;
      root.hidden = true;
    },
    retarget(next: Morphology): void {
      // A generation half-evaluated against the old body would be comparing scores from two
      // different robots, so the island starts again rather than carrying anything over.
      morph = next;
      evaluate = makeEvaluator(morph, { seconds: trialSeconds });
      reset();
    },
    get isOpen(): boolean {
      return open;
    },
  };
  return api;
}
