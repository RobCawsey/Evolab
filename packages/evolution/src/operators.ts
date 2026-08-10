/**
 * Genetic operators. Every one of them works on a flat vector in [0, 1]^n and takes an
 * `Rng` explicitly — none of them knows what a gene means, and none of them can reach for
 * `Math.random()` (ground rule 2).
 *
 * Pure. Runs under Node. No DOM, no Rapier, no I/O.
 */

import type { Genome } from './controller.ts';
import type { Rng } from './rng.ts';

/** Distribution index for SBX. Higher values keep children closer to their parents. */
export const SBX_ETA = 15;
/** Distribution index for polynomial mutation. */
export const MUTATION_ETA = 20;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A uniformly random genome. The starting population is drawn from this. */
export function randomGenome(length: number, rng: Rng): Genome {
  const g = new Float32Array(length);
  for (let i = 0; i < length; i++) g[i] = rng.float();
  return g;
}

/**
 * Tournament selection. Draw `size` individuals uniformly at random and return the index
 * of the fittest.
 *
 * This is the whole of selection pressure, and it is worth understanding how gentle it is:
 * with size 3, the worst individual in a population of 24 still has roughly a 1-in-1700
 * chance of being picked. Weak pressure preserves diversity; strong pressure converges
 * fast on whatever happened to be good early.
 */
export function tournament(
  fitness: readonly number[],
  size: number,
  rng: Rng,
  drawn?: number[],
): number {
  let best = rng.int(fitness.length);
  drawn?.push(best);
  for (let i = 1; i < size; i++) {
    const challenger = rng.int(fitness.length);
    drawn?.push(challenger);
    if (fitness[challenger]! > fitness[best]!) best = challenger;
  }
  return best;
}

/**
 * Simulated binary crossover. Produces two children that are distributed around their
 * parents the way single-point binary crossover would be on a bit string — hence the name.
 *
 *   beta = (2u)^(1/(eta+1))                if u <= 0.5
 *   beta = (1 / (2(1-u)))^(1/(eta+1))      otherwise
 *   c1   = 0.5[(1+beta)p1 + (1-beta)p2]
 *   c2   = 0.5[(1-beta)p1 + (1+beta)p2]
 *
 * SBX blends rather than splices, which is what continuous control parameters want: the
 * midpoint of two gaits that both half-work is often a gait that works, whereas splicing
 * the first half of one genome onto the second half of another usually is not.
 */
export function sbx(
  p1: Genome,
  p2: Genome,
  rng: Rng,
  eta = SBX_ETA,
  probability = 0.9,
  blended?: boolean[],
): [Genome, Genome] {
  const n = p1.length;
  const c1 = new Float32Array(n);
  const c2 = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const a = p1[i]!;
    const b = p2[i]!;
    if (rng.float() > probability) {
      c1[i] = a;
      c2[i] = b;
      blended?.push(false);
      continue;
    }
    blended?.push(true);
    const u = rng.float();
    const beta = u <= 0.5
      ? Math.pow(2 * u, 1 / (eta + 1))
      : Math.pow(1 / (2 * (1 - u)), 1 / (eta + 1));
    c1[i] = clamp01(0.5 * ((1 + beta) * a + (1 - beta) * b));
    c2[i] = clamp01(0.5 * ((1 - beta) * a + (1 + beta) * b));
  }
  return [c1, c2];
}

/**
 * Polynomial mutation, in place.
 *
 *   delta = (2u)^(1/(eta+1)) - 1           if u < 0.5
 *   delta = 1 - (2(1-u))^(1/(eta+1))       otherwise
 *   x'    = clamp(x + delta, 0, 1)
 *
 * The distribution is sharply peaked at zero, so most mutations are tiny nudges and a few
 * are large jumps. That is the shape you want late in a run — fine adjustment by default,
 * with a rare chance of escaping a local optimum.
 *
 * `rate` is per gene. The default of 1/n means about one gene changes per genome.
 */
export interface GeneChange {
  readonly gene: number;
  readonly from: number;
  readonly to: number;
}

export function mutate(
  genome: Genome,
  rng: Rng,
  rate = 1 / genome.length,
  eta = MUTATION_ETA,
  changes?: GeneChange[],
): Genome {
  for (let i = 0; i < genome.length; i++) {
    if (rng.float() >= rate) continue;
    const u = rng.float();
    const delta = u < 0.5
      ? Math.pow(2 * u, 1 / (eta + 1)) - 1
      : 1 - Math.pow(2 * (1 - u), 1 / (eta + 1));
    const from = genome[i]!;
    genome[i] = clamp01(from + delta);
    changes?.push({ gene: i, from, to: genome[i]! });
  }
  return genome;
}

/**
 * Mean pairwise Euclidean distance in genome space.
 *
 * The number to watch alongside fitness. Diversity collapsing while fitness flattens means
 * premature convergence: the population has agreed on a mediocre answer and no longer has
 * the variation to find a better one. A rising best with healthy diversity means the search
 * is still working.
 *
 * O(n^2) in population size, which is fine at 24 and would not be at 2400.
 */
export function diversity(population: readonly Genome[]): number {
  const n = population.length;
  if (n < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = population[i]!;
      const b = population[j]!;
      let sum = 0;
      for (let k = 0; k < a.length; k++) {
        const d = a[k]! - b[k]!;
        sum += d * d;
      }
      total += Math.sqrt(sum);
      pairs++;
    }
  }
  return total / pairs;
}
