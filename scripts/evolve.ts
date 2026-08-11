/**
 * Run a search from the command line and print progress.
 *
 *   npm run evolve
 *   npm run evolve -- --seed 7 --gens 60 --pop 32 --seconds 6
 *
 * Console output only; the charts arrive in slice 3. Read the diversity column as closely
 * as the fitness one — a flat best with collapsing diversity is a converged run, not a
 * finished one.
 */

import {
  archiveBest,
  archiveCoverage,
  archiveQd,
  createIsland,
  decodeGenome,
  encodeGenome,
  score,
  simpleBiped,
  stepGeneration,
  type GaitParams,
  type GenerationSummary,
} from '../packages/evolution/src/index.ts';
import { evaluate, initPhysics, makeEvaluator } from '../packages/sim/src/index.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const SEED = arg('seed', 4417);
const GENERATIONS = arg('gens', 30);
const POPULATION = arg('pop', 24);
const SECONDS = arg('seconds', 4);

await initPhysics();

const morph = simpleBiped();
const island = createIsland(0, SEED, { size: POPULATION, trialSeconds: SECONDS });
const evaluator = makeEvaluator(morph, { seconds: SECONDS });

console.log(`morphology   ${morph.name}: ${morph.joints.length} joints, genome length ${island.config.genomeLength}`);
console.log(`population   ${POPULATION}   generations ${GENERATIONS}   trial ${SECONDS} s`);
console.log(`operators    tournament ${island.config.tournamentSize}, elites ${island.config.elites}, ` +
  `SBX p=${island.config.crossoverProbability}, mutation 1/${island.config.genomeLength}`);
console.log(`seed         ${SEED}\n`);
console.log('  gen    best     mean    worst   diversity   dist   upright   evals');

const started = Date.now();
let previousBest = -Infinity;
let regressions = 0;
const history: GenerationSummary[] = [];

for (let g = 0; g < GENERATIONS; g++) {
  const s = stepGeneration(island, evaluator);
  history.push(s);

  // Elitism guarantees this. If it ever trips, the operators are wrong.
  if (s.best < previousBest - 1e-9) regressions++;
  previousBest = s.best;

  if (g % Math.max(1, Math.floor(GENERATIONS / 15)) === 0 || g === GENERATIONS - 1) {
    const r = s.bestResult;
    console.log(
      `  ${String(s.generation).padStart(3)}  ` +
      `${s.best.toFixed(3).padStart(6)}  ${s.mean.toFixed(3).padStart(6)}  ${s.worst.toFixed(3).padStart(6)}  ` +
      `${s.diversity.toFixed(3).padStart(9)}  ` +
      `${(r?.distance ?? 0).toFixed(2).padStart(5)}  ` +
      `${(r?.uprightTime ?? 0).toFixed(2).padStart(6)} s  ` +
      `${String(s.evaluations).padStart(5)}`,
    );
  }
}

const elapsed = (Date.now() - started) / 1000;
const last = history[history.length - 1]!;
const params: GaitParams = decodeGenome(last.bestGenome);
const breakdown = last.bestResult ? score(last.bestResult, SECONDS) : null;

console.log(`\nfinished     ${GENERATIONS} generations in ${elapsed.toFixed(2)} s ` +
  `(${(elapsed / GENERATIONS * 1000).toFixed(0)} ms/gen, ` +
  `${history.reduce((n, s) => n + s.evaluations, 0)} trials)`);
console.log(`monotonic    ${regressions === 0 ? 'yes — elitism holds' : `NO — ${regressions} regressions`}`);

console.log(`\nchampion     fitness ${last.best.toFixed(4)}`);
if (last.bestResult && breakdown) {
  console.log(`  distance   ${last.bestResult.distance.toFixed(3)} m        (term ${breakdown.distance.toFixed(3)})`);
  console.log(`  upright    ${last.bestResult.uprightTime.toFixed(2)} s of ${SECONDS} s   (term ${breakdown.upright.toFixed(3)})`);
  console.log(`  effort     ${last.bestResult.effort.toFixed(1)} rad       (term ${breakdown.effort.toFixed(3)})`);
  console.log(`  fell       ${last.bestResult.fell ? 'yes' : 'no'}`);
  console.log(`  stride     ${last.bestResult.strideLength.toFixed(3)} m        (behaviour — not scored)`);
  console.log(`  duty       ${last.bestResult.dutyFactor.toFixed(3)}          (behaviour — not scored)`);
}

// The behaviour archive. Coverage is the number to watch: best fitness can sit still for
// twenty generations while the map is still filling, and a run that ends with one brilliant
// cell has not explored, whatever its maximum says.
const archive = island.archive;
console.log(`\narchive      ${archive.filled} of ${archive.cells.length} cells ` +
  `(${(archiveCoverage(archive) * 100).toFixed(1)}% coverage), QD score ${archiveQd(archive).toFixed(1)}`);
console.log(`  offers     ${archive.attempts} trials survived to be filed, ` +
  `${archive.improvements} claimed or improved a cell ` +
  `(${((archive.improvements / Math.max(1, archive.attempts)) * 100).toFixed(0)}%)`);
{
  // A coarse text rendering: four archive cells per character, so the shape of the map is
  // visible without a browser. Same data the canvas blits.
  const cols = archive.stride.bins;
  const rows = archive.duty.bins;
  const peak = archiveBest(archive)?.fitness ?? 0;
  const ramp = ' .:-=+*#%@';
  for (let row = rows - 1; row >= 0; row -= 2) {
    let line = '';
    for (let col = 0; col < cols; col += 2) {
      // Brightest of the 2 × 2 block, so a lone good cell is never averaged away.
      let f = -1;
      for (let dr = 0; dr < 2; dr++) {
        for (let dc = 0; dc < 2; dc++) {
          const cell = archive.cells[(row - dr) * cols + col + dc];
          if (cell) f = Math.max(f, cell.fitness);
        }
      }
      line += f < 0 ? ' ' : ramp[Math.min(ramp.length - 1, Math.round((f / peak) * (ramp.length - 1)))];
    }
    const label = row === rows - 1 ? `duty ${archive.duty.max.toFixed(2)}`
      : row <= 1 ? `     ${archive.duty.min.toFixed(2)}` : '';
    console.log(`  ${label.padStart(9)} |${line}|`);
  }
  const width = cols / 2;
  const label = 'stride, m';
  console.log(`            +${'-'.repeat(width)}+`);
  console.log(`            ${archive.stride.min.toFixed(1).padEnd(width - 2)}` +
    `${archive.stride.max.toFixed(1)}`);
  console.log(`            ${' '.repeat(Math.max(0, ((width - label.length) / 2) | 0))}${label}`);
}
// Generalisation check. The search sees exactly one starting perturbation, so a champion
// is tuned to it and will be more fragile than its fitness suggests. Re-running on unseen
// tilts turns that from a hidden problem into a printed number — and it is the argument
// for the five-seed median the task suite uses in slice 14.
const UNSEEN = [101, 102, 103, 104, 105];
const retested = UNSEEN.map((s) => evaluate(morph, last.bestGenome, { seed: s, seconds: SECONDS }));
const distances = retested.map((r) => r.distance).sort((a, b) => a - b);
const survived = retested.filter((r) => !r.fell).length;
console.log(`\ngeneralises  ${survived}/${UNSEEN.length} unseen tilts stayed upright`);
console.log(`  distances  ${distances.map((d) => d.toFixed(2)).join(', ')} m   median ${distances[2]!.toFixed(2)} m`);
if (survived < UNSEEN.length) {
  console.log('  note       the champion is overfitted to its training tilt. Expected at this');
  console.log('             stage: one seed per trial is slice 2 scope, five-seed medians are §6.');
}

console.log(`\ngait         ${JSON.stringify(params, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v))}`);
console.log(`url          gait=${[
  params.frequency, params.balanceGain,
  params.hip.amplitude, params.hip.phase, params.hip.centre,
  params.knee.amplitude, params.knee.phase, params.knee.centre,
  params.ankle.amplitude, params.ankle.phase, params.ankle.centre,
].map((v) => v.toFixed(3)).join(',')}`);

// Round-trip guard: the printed gait must be the genome that was actually evaluated.
const reencoded = encodeGenome(params);
let drift = 0;
for (let i = 0; i < reencoded.length; i++) drift = Math.max(drift, Math.abs(reencoded[i]! - last.bestGenome[i]!));
if (drift > 1e-6) console.log(`\nWARNING: genome round-trip drift ${drift.toExponential(2)}`);
