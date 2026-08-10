/**
 * A population and its generation loop.
 *
 * `stepGeneration` takes the evaluator as a *parameter* rather than importing one. That is
 * ground rule 3 made concrete: this file never imports `packages/sim`, so the entire
 * genetic algorithm runs under Node in milliseconds against a synthetic evaluator, and the
 * golden test does not depend on the physics.
 */

import { GENOME_LENGTH, type Genome } from './controller.ts';
import { DEFAULT_OBJECTIVE, score, type Objective, type TrialResult } from './fitness.ts';
import {
  MUTATION_ETA,
  SBX_ETA,
  diversity,
  mutate,
  randomGenome,
  sbx,
  tournament,
  type GeneChange,
} from './operators.ts';
import { Rng } from './rng.ts';

export interface Individual {
  readonly genes: Genome;
  fitness: number;
  result: TrialResult | null;
}

export interface IslandConfig {
  readonly size: number;
  readonly genomeLength: number;
  readonly tournamentSize: number;
  readonly elites: number;
  readonly crossoverProbability: number;
  /** Per-gene mutation probability. Defaults to 1/genomeLength when omitted. */
  readonly mutationRate?: number;
  readonly trialSeconds: number;
  readonly objective: Objective;
  /**
   * Seed passed to the evaluator, fixed for the whole run.
   *
   * It must not vary by generation. Elites carry their fitness forward without being
   * re-evaluated, so if the trial conditions changed underneath them a genome that got a
   * favourable draw would keep that score for ever, and the reported champion would be
   * part luck. Holding it fixed makes every individual comparable and makes best fitness
   * genuinely monotonic.
   *
   * The cost is that a champion is tuned to one starting perturbation and will be more
   * fragile than its fitness suggests — which is exactly why §6 of the design document
   * scores the task suite across five seeds and reports the median.
   */
  readonly trialSeed: number;
}

export const DEFAULT_CONFIG: IslandConfig = {
  size: 24,
  genomeLength: GENOME_LENGTH,
  tournamentSize: 3,
  elites: 2,
  crossoverProbability: 0.9,
  trialSeconds: 4,
  objective: DEFAULT_OBJECTIVE,
  trialSeed: 0,
};

export interface Island {
  readonly id: number;
  readonly rng: Rng;
  readonly config: IslandConfig;
  generation: number;
  population: Individual[];
}

export interface GenerationSummary {
  readonly generation: number;
  readonly best: number;
  readonly mean: number;
  readonly worst: number;
  /** Mean pairwise Euclidean distance in genome space. Watch this, not just `best`. */
  readonly diversity: number;
  readonly bestGenome: Genome;
  readonly bestResult: TrialResult | null;
  /** Trials actually run this generation. Elites are carried over, not re-evaluated. */
  readonly evaluations: number;
}

/** Given a genome and a seed, run one trial. Supplied by the caller. */
export type Evaluator = (genome: Genome, seed: number) => TrialResult;

export function createIsland(
  id: number,
  seed: number,
  config: Partial<IslandConfig> = {},
): Island {
  const cfg: IslandConfig = { ...DEFAULT_CONFIG, ...config };
  const rng = new Rng(seed);
  const population: Individual[] = [];
  for (let i = 0; i < cfg.size; i++) {
    population.push({ genes: randomGenome(cfg.genomeLength, rng), fitness: 0, result: null });
  }
  return { id, rng, config: cfg, generation: 0, population };
}

/** How many individuals still need a trial before this generation can complete. */
export function pendingCount(island: Island): number {
  let n = 0;
  for (const ind of island.population) if (ind.result === null) n++;
  return n;
}

/**
 * Evaluate individuals that do not yet have a result, stopping when `shouldContinue`
 * returns false. Returns how many trials were run.
 *
 * Splitting evaluation out of the generation is what lets a browser run a search without
 * freezing: a generation of 24 four-second trials costs roughly 300 ms on one core, which
 * is twenty times a frame, so the UI evaluates a few individuals per frame instead.
 *
 * The budget check is a predicate supplied by the caller rather than a clock read here —
 * `packages/evolution` has no timers (ground rule 3), and this keeps it that way.
 *
 * Elites carried from the previous generation already have a result and are skipped: the
 * evaluator is deterministic in `(genome, trialSeed)`, so re-running one would return the
 * same numbers at the same cost. That is also why `trialSeed` must not vary by generation —
 * see `IslandConfig.trialSeed`.
 */
export function evaluatePending(
  island: Island,
  evaluate: Evaluator,
  shouldContinue: () => boolean = () => true,
): number {
  const cfg = island.config;
  let evaluations = 0;
  for (const ind of island.population) {
    if (ind.result !== null) continue;
    if (evaluations > 0 && !shouldContinue()) break;
    const result = evaluate(ind.genes, cfg.trialSeed);
    ind.result = result;
    ind.fitness = score(result, cfg.trialSeconds, cfg.objective).total;
    evaluations++;
  }
  return evaluations;
}

/* ---------------- stages ---------------- */

/**
 * What one operator did, for the stepper to draw.
 *
 * These are only produced when tracing is switched on. A normal run yields nothing at all,
 * so the worker path pays no allocation for a screen nobody is looking at.
 */
export interface TournamentTrace {
  /** Population indices drawn, in order. Length is the tournament size. */
  readonly drawn: readonly number[];
  readonly winner: number;
}

export interface CrossoverTrace {
  readonly parents: readonly [number, number];
  readonly a: Genome;
  readonly b: Genome;
  readonly children: readonly [Genome, Genome];
  /**
   * Per gene: was this position blended, or copied straight from a parent?
   *
   * SBX interpolates gene by gene rather than splicing at a cut point, so there is no
   * "cut" to report — an earlier draft of the plan assumed two-point crossover and asked
   * for `cut: [number, number]`, which would have meant drawing something the algorithm
   * does not do.
   */
  readonly blended: readonly boolean[];
}

export type Stage =
  | { readonly stage: 'population'; readonly generation: number; readonly size: number; readonly pending: number }
  | { readonly stage: 'evaluate'; readonly evaluations: number; readonly fitnesses: readonly number[]; readonly ranked: readonly number[] }
  | { readonly stage: 'select'; readonly pair: number; readonly tournaments: readonly [TournamentTrace, TournamentTrace] }
  | { readonly stage: 'crossover'; readonly pair: number; readonly trace: CrossoverTrace }
  | { readonly stage: 'mutate'; readonly pair: number; readonly children: readonly Genome[]; readonly changes: readonly (readonly GeneChange[])[] }
  | { readonly stage: 'replace'; readonly summary: GenerationSummary };

export interface GenerationOptions {
  /** Emit stages. Off by default, because a normal run has nobody watching. */
  readonly trace?: boolean;
}

/* ---------------- the generation ---------------- */

interface Ranking {
  readonly ranked: Individual[];
  readonly fitnesses: number[];
  readonly summary: GenerationSummary;
}

function rankPopulation(island: Island, evaluations: number): Ranking {
  const ranked = [...island.population].sort((a, b) => b.fitness - a.fitness);
  const fitnesses = island.population.map((i) => i.fitness);
  const best = ranked[0]!;
  return {
    ranked,
    fitnesses,
    summary: {
      generation: island.generation,
      best: best.fitness,
      mean: fitnesses.reduce((s, f) => s + f, 0) / fitnesses.length,
      worst: ranked[ranked.length - 1]!.fitness,
      diversity: diversity(island.population.map((i) => i.genes)),
      bestGenome: Float32Array.from(best.genes),
      bestResult: best.result,
      evaluations,
    },
  };
}

/**
 * Select, cross and mutate until the next population is full, yielding after each operator
 * when tracing.
 *
 * The order of random draws here is load-bearing and must not be rearranged. It is, per
 * breeding pair: two tournaments, one crossover, then a mutation for each child that is
 * actually kept. Grouping all the tournaments together and then all the crossovers — the
 * obvious way to get three tidy phases for the UI — would change that order and silently
 * invalidate every stored gait, and the golden test with them. Hence stepping per *pair*
 * rather than per phase, which is also the more useful thing to watch: you follow one
 * child from selection to birth.
 */
function* breed(
  island: Island,
  ranked: readonly Individual[],
  fitnesses: readonly number[],
  trace: boolean,
): Generator<Stage, void> {
  const { config: cfg, rng } = island;
  const mutationRate = cfg.mutationRate ?? 1 / cfg.genomeLength;
  const next: Individual[] = [];

  // Elitism. Not optional: without it the best gait can be lost to an unlucky draw and
  // the fitness curve develops dips that look exactly like a bug in the operators.
  for (let i = 0; i < cfg.elites && i < ranked.length; i++) {
    const e = ranked[i]!;
    next.push({ genes: Float32Array.from(e.genes), fitness: e.fitness, result: e.result });
  }

  let pair = 0;
  while (next.length < cfg.size) {
    const drawnA = trace ? [] : undefined;
    const drawnB = trace ? [] : undefined;
    const ia = tournament(fitnesses, cfg.tournamentSize, rng, drawnA);
    const ib = tournament(fitnesses, cfg.tournamentSize, rng, drawnB);
    const a = island.population[ia]!;
    const b = island.population[ib]!;
    if (trace) {
      yield {
        stage: 'select',
        pair,
        tournaments: [
          { drawn: drawnA!, winner: ia },
          { drawn: drawnB!, winner: ib },
        ],
      };
    }

    const blended = trace ? [] : undefined;
    const [c1, c2] = sbx(a.genes, b.genes, rng, SBX_ETA, cfg.crossoverProbability, blended);
    if (trace) {
      yield {
        stage: 'crossover',
        pair,
        trace: {
          parents: [ia, ib],
          a: Float32Array.from(a.genes),
          b: Float32Array.from(b.genes),
          children: [Float32Array.from(c1), Float32Array.from(c2)],
          blended: blended!,
        },
      };
    }

    const kept: Genome[] = [];
    const changes: GeneChange[][] = [];
    for (const child of [c1, c2]) {
      // The population can fill on the first child, in which case the second is discarded
      // *before* being mutated and consumes no randomness. Preserving that is part of
      // preserving the draw order.
      if (next.length >= cfg.size) break;
      const record = trace ? [] : undefined;
      mutate(child, rng, mutationRate, MUTATION_ETA, record);
      if (trace) {
        kept.push(Float32Array.from(child));
        changes.push(record!);
      }
      next.push({ genes: child, fitness: 0, result: null });
    }
    if (trace) yield { stage: 'mutate', pair, children: kept, changes };

    pair++;
  }

  island.population = next;
  island.generation++;
}

/**
 * One generation as a generator, yielding at each operator boundary.
 *
 * This is the single implementation of a generation. Running normally drains it; the
 * stepper advances it one `next()` at a time. One code path, two speeds — which is why the
 * teaching screen shows the real algorithm rather than an illustration of it.
 *
 * A caller that abandons the generator part-way leaves the island half-bred. Drain it or
 * discard the island.
 */
export function* generation(
  island: Island,
  evaluate: Evaluator,
  opts: GenerationOptions = {},
): Generator<Stage, GenerationSummary> {
  const trace = opts.trace ?? false;

  if (trace) {
    yield {
      stage: 'population',
      generation: island.generation,
      size: island.population.length,
      pending: pendingCount(island),
    };
  }

  const evaluations = evaluatePending(island, evaluate);
  const { ranked, fitnesses, summary } = rankPopulation(island, evaluations);

  if (trace) {
    const order = island.population
      .map((_, index) => index)
      .sort((x, y) => fitnesses[y]! - fitnesses[x]!);
    yield { stage: 'evaluate', evaluations, fitnesses, ranked: order };
  }

  yield* breed(island, ranked, fitnesses, trace);

  if (trace) yield { stage: 'replace', summary };
  return summary;
}

/**
 * Rank the scored population, breed the next one, advance the generation counter.
 *
 * The non-generator half of a generation, for the incremental caller that has already run
 * `evaluatePending` itself. Shares `breed`, so it cannot drift from the stepper.
 */
export function completeGeneration(island: Island, evaluations: number): GenerationSummary {
  const { ranked, fitnesses, summary } = rankPopulation(island, evaluations);
  const it = breed(island, ranked, fitnesses, false);
  while (!it.next().done) { /* nothing to observe */ }
  return summary;
}

/**
 * Evaluate, select, breed, replace. One whole generation, returned as a summary.
 *
 * The all-at-once form, used by the workers, the CLI and the tests.
 */
export function stepGeneration(island: Island, evaluate: Evaluator): GenerationSummary {
  const it = generation(island, evaluate);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/* ---------------- migration ---------------- */

/**
 * Copies of the fittest `count` genomes, for sending to a neighbouring island.
 *
 * Copies, not references. The caller will almost certainly transfer these across a worker
 * boundary, and a transferred `ArrayBuffer` is detached on the sending side — handing out
 * the island's own genomes would empty its population.
 */
export function emigrants(island: Island, count: number): Genome[] {
  const ranked = [...island.population].sort((a, b) => b.fitness - a.fitness);
  const n = Math.min(count, ranked.length);
  const out: Genome[] = [];
  for (let i = 0; i < n; i++) out.push(Float32Array.from(ranked[i]!.genes));
  return out;
}

/**
 * Accept migrants, replacing the least fit individuals.
 *
 * Arrivals come in unscored and are marked pending, so they face this island's evaluator on
 * the next generation rather than carrying a fitness earned somewhere else. Islands share a
 * morphology and a trial seed today, so the score would in fact be identical — but relying
 * on that would make the two configurations silently coupled, and it is one trial.
 *
 * Never displaces more than half the population, however many arrive: a flood of migrants
 * would otherwise wipe out exactly the local variation the island model exists to preserve.
 */
export function immigrate(island: Island, incoming: readonly Genome[]): number {
  if (incoming.length === 0) return 0;
  const limit = Math.floor(island.population.length / 2);
  const take = Math.min(incoming.length, limit);
  if (take === 0) return 0;

  const order = island.population
    .map((ind, index) => ({ index, fitness: ind.fitness }))
    .sort((a, b) => a.fitness - b.fitness);

  for (let i = 0; i < take; i++) {
    island.population[order[i]!.index] = {
      genes: Float32Array.from(incoming[i]!),
      fitness: 0,
      result: null,
    };
  }
  return take;
}

/** Convenience: run `generations` of a fresh island and return every summary. */
export function evolve(
  island: Island,
  generations: number,
  evaluate: Evaluator,
  onGeneration?: (s: GenerationSummary) => void,
): GenerationSummary[] {
  const history: GenerationSummary[] = [];
  for (let g = 0; g < generations; g++) {
    const s = stepGeneration(island, evaluate);
    history.push(s);
    onGeneration?.(s);
  }
  return history;
}
