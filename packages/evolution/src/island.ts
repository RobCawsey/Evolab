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
import { diversity, mutate, randomGenome, sbx, tournament } from './operators.ts';
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

/**
 * Rank the scored population, breed the next one, advance the generation counter.
 *
 * Must only be called once every individual has a result — `stepGeneration` guarantees
 * that, and the incremental caller checks `pendingCount` first. Everything that consumes
 * randomness happens here, in a fixed order, which is what makes the golden test stable
 * regardless of how evaluation was scheduled.
 */
export function completeGeneration(island: Island, evaluations: number): GenerationSummary {
  const { config: cfg, rng } = island;
  const mutationRate = cfg.mutationRate ?? 1 / cfg.genomeLength;

  // --- rank ---------------------------------------------------------------------
  const ranked = [...island.population].sort((a, b) => b.fitness - a.fitness);
  const fitnesses = island.population.map((i) => i.fitness);
  const best = ranked[0]!;
  const summary: GenerationSummary = {
    generation: island.generation,
    best: best.fitness,
    mean: fitnesses.reduce((s, f) => s + f, 0) / fitnesses.length,
    worst: ranked[ranked.length - 1]!.fitness,
    diversity: diversity(island.population.map((i) => i.genes)),
    bestGenome: Float32Array.from(best.genes),
    bestResult: best.result,
    evaluations,
  };

  // --- breed --------------------------------------------------------------------
  const next: Individual[] = [];

  // Elitism. Not optional: without it the best gait can be lost to an unlucky draw and
  // the fitness curve develops dips that look exactly like a bug in the operators.
  for (let i = 0; i < cfg.elites && i < ranked.length; i++) {
    const e = ranked[i]!;
    next.push({ genes: Float32Array.from(e.genes), fitness: e.fitness, result: e.result });
  }

  while (next.length < cfg.size) {
    const a = island.population[tournament(fitnesses, cfg.tournamentSize, rng)]!;
    const b = island.population[tournament(fitnesses, cfg.tournamentSize, rng)]!;
    const [c1, c2] = sbx(a.genes, b.genes, rng, undefined, cfg.crossoverProbability);
    for (const child of [c1, c2]) {
      if (next.length >= cfg.size) break;
      mutate(child, rng, mutationRate);
      next.push({ genes: child, fitness: 0, result: null });
    }
  }

  island.population = next;
  island.generation++;
  return summary;
}

/**
 * Evaluate, select, breed, replace. One whole generation, returned as a summary.
 *
 * The all-at-once form, used by the CLI and the tests. The browser drives
 * `evaluatePending` and `completeGeneration` separately so it can yield to the frame,
 * but the sequence of random draws is identical either way.
 */
export function stepGeneration(island: Island, evaluate: Evaluator): GenerationSummary {
  const evaluations = evaluatePending(island, evaluate);
  return completeGeneration(island, evaluations);
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
