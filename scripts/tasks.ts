/**
 * Put a gait through the task suite and print the scorecard.
 *
 *   npm run tasks                       # evolve a champion first, then test it
 *   npm run tasks -- --gens 60
 *   npm run tasks -- --gait 1.672,0.557,...   # test a specific gait
 *   npm run tasks -- --calibrate        # every task's raw numbers, for setting thresholds
 *
 * The counterpart to `npm run evolve`: that one prints what the search found, this one prints
 * what it is worth. Headless and single-island, so it needs no browser and no .NET.
 */

import {
  buildBiped,
  buildScorecard,
  createIsland,
  DEFAULT_SPEC,
  decodeGenome,
  METRIC_UNITS,
  METRICS,
  stepGeneration,
  TASK_SEEDS,
  TASKS,
  taskMorphology,
  type Badge,
  type GaitParams,
  type Task,
  type TrialResult,
} from '../packages/evolution/src/index.ts';
import { evaluateGait, initPhysics, makeEvaluator } from '../packages/sim/src/index.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

await initPhysics();

const morph = buildBiped(DEFAULT_SPEC);
const seed = arg('seed', 4417);
const gens = arg('gens', 30);

/** Run one task across every seed. This is the only place the suite touches the simulator. */
function runTask(gait: GaitParams, task: Task): TrialResult[] {
  const body = taskMorphology(morph, task);
  return TASK_SEEDS.map((s) =>
    evaluateGait(body, gait, {
      seed: s,
      seconds: task.seconds,
      ...(task.terrain ? { terrain: task.terrain } : {}),
      ...(task.impulses ? { impulses: task.impulses } : {}),
    }),
  );
}

function gaitFromArgs(): GaitParams {
  const i = process.argv.indexOf('--gait');
  if (i >= 0 && process.argv[i + 1]) {
    // Eleven numbers in controller units — exactly what `npm run evolve` prints on its `url`
    // line, so a champion can be pasted straight from one command into the other.
    const p = process.argv[i + 1]!.split(',').map(Number);
    if (p.length !== 11 || p.some((v) => !Number.isFinite(v))) {
      console.error('--gait wants eleven comma-separated numbers, as `npm run evolve` prints them.');
      process.exit(1);
    }
    return {
      frequency: p[0]!, balanceGain: p[1]!,
      hip: { amplitude: p[2]!, phase: p[3]!, centre: p[4]! },
      knee: { amplitude: p[5]!, phase: p[6]!, centre: p[7]! },
      ankle: { amplitude: p[8]!, phase: p[9]!, centre: p[10]! },
    };
  }

  process.stdout.write(`evolving ${gens} generations at seed ${seed}…`);
  const island = createIsland(0, seed, { trialSeconds: 4 });
  const evaluator = makeEvaluator(morph, { seconds: 4 });
  for (let g = 0; g < gens; g++) stepGeneration(island, evaluator);
  const best = island.population.reduce((a, b) => (b.fitness > a.fitness ? b : a));
  process.stdout.write(` best fitness ${best.fitness.toFixed(4)}\n\n`);
  return decodeGenome(best.genes);
}

const gait = gaitFromArgs();

/* ---------------- calibration ---------------- */

if (has('calibrate')) {
  // Every task's raw values across a spread of gaits, which is what thresholds get set from.
  // Slice 8's lesson: both archive axis ranges came from the textbook and both were wrong.
  const seeds = [4417, 7, 42, 101, 777];
  const gaits: GaitParams[] = [];
  for (const s of seeds) {
    const island = createIsland(0, s, { trialSeconds: 4 });
    const evaluator = makeEvaluator(morph, { seconds: 4 });
    for (let g = 0; g < gens; g++) stepGeneration(island, evaluator);
    gaits.push(decodeGenome(island.population.reduce((a, b) => (b.fitness > a.fitness ? b : a)).genes));
  }

  console.log(`calibration · ${gaits.length} gaits × ${TASK_SEEDS.length} seeds · ${gens} generations\n`);
  console.log('task'.padEnd(11) + 'unit'.padEnd(8) +
    gaits.map((_, i) => `g${i}`.padStart(9)).join('') + '     median');
  for (const task of TASKS) {
    const medians = gaits.map((g) => {
      const vs = runTask(g, task).map(METRICS[task.metric]).sort((a, b) => a - b);
      return vs[vs.length >> 1]!;
    });
    const all = [...medians].sort((a, b) => a - b);
    console.log(
      task.name.padEnd(11) + METRIC_UNITS[task.metric].padEnd(8) +
      medians.map((v) => v.toFixed(2).padStart(9)).join('') +
      `  ${all[all.length >> 1]!.toFixed(2).padStart(9)}`,
    );
  }
  process.exit(0);
}

/* ---------------- the scorecard ---------------- */

const started = Date.now();
const byTask = new Map<string, TrialResult[]>();
for (const task of TASKS) byTask.set(task.key, runTask(gait, task));
const elapsed = (Date.now() - started) / 1000;

const card = buildScorecard(byTask);

const MARK: Record<Badge, string> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE', fail: 'FAIL' };

console.log('task        median    spread            fell   badge');
console.log('─'.repeat(58));
for (const s of card.tasks) {
  const unit = METRIC_UNITS[s.task.metric];
  console.log(
    s.task.name.padEnd(11) +
    `${s.median.toFixed(2)} ${unit}`.padStart(10) + '  ' +
    `${s.low.toFixed(2)}–${s.high.toFixed(2)}`.padStart(15) + '  ' +
    `${s.fell}/${TASK_SEEDS.length}`.padStart(5) + '   ' +
    MARK[s.badge],
  );
}
console.log('─'.repeat(58));
console.log(`${'overall'.padEnd(11)}${`${card.passed}/${card.tasks.length} passed`.padStart(10)}` +
  `${''.padStart(17)}${''.padStart(8)}${MARK[card.overall]}`);
console.log(`\n${TASKS.length} tasks × ${TASK_SEEDS.length} seeds in ${elapsed.toFixed(2)} s`);

// The spread is the part worth reading. §6: a gait that clears the steps once in five is a
// gait that does not clear the steps.
const widest = card.tasks.reduce((a, b) => (b.high - b.low > a.high - a.low ? b : a));
if (widest.high - widest.low > 0.5) {
  console.log(
    `\nwidest spread: ${widest.task.name} ranges ${widest.low.toFixed(2)}–${widest.high.toFixed(2)} ` +
    `${METRIC_UNITS[widest.task.metric]} across five seeds — that is luck, not a gait.`,
  );
}
