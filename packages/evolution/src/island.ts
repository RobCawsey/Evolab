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

/**
 * Evaluate, select, breed, replace. One generation, returned as a summary.
 *
 * Order matters and is fixed: the whole population is scored before any selection happens,
 * so an individual's fitness never depends on where it sits in the array.
 */
export function stepGeneration(island: Island, evaluate: Evaluator): GenerationSummary {
  const { config: cfg, rng } = island;
  const mutationRate = cfg.mutationRate ?? 1 / cfg.genomeLength;

  // --- evaluate -----------------------------------------------------------------
  // Elites carried from the previous generation already have a fitness and are not
  // re-run: the evaluator is deterministic in (genome, seed), so a second trial would
  // return the same numbers and cost the same time.
  let evaluations = 0;
  for (const ind of island.population) {
    if (ind.result !== null) continue;
    const result = evaluate(ind.genes, cfg.trialSeed);
    ind.result = result;
    ind.fitness = score(result, cfg.trialSeconds, cfg.objective).total;
    evaluations++;
  }

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
