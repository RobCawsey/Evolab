/**
 * What a trial produced, and what that is worth.
 *
 * `TrialResult` lives here rather than in `packages/sim` because it is a description of an
 * outcome, not a piece of physics — and because `packages/evolution` may not import the
 * simulator (ground rule 3). The simulator produces one of these; the search consumes it.
 */

export interface TrialResult {
  /** Forward displacement of the torso, metres. Negative means it went backwards. */
  readonly distance: number;
  /** Seconds upright before falling, or the whole trial if it never fell. */
  readonly uprightTime: number;
  /**
   * Total joint travel over the trial, radians summed across all joints.
   *
   * The design document asks for energy in joules. That is not measurable here: Rapier's
   * JavaScript binding exposes no joint impulses, so the torque a motor actually applied
   * cannot be read back. Joint travel is the honest stand-in — for a position-controlled
   * robot it tracks actuation effort closely and it penalises exactly the failure mode
   * worth penalising, which is frantic high-frequency thrashing. Named for what it
   * measures rather than for what it approximates.
   */
  readonly effort: number;
  readonly fell: boolean;
  /** Trial length actually simulated, seconds. Shorter than requested if it fell early. */
  readonly duration: number;
  /**
   * Mean forward displacement between consecutive touchdowns of the same foot, metres.
   *
   * A *stride*, not a step: heel-strike to the next heel-strike of that same foot, which is
   * one whole gait cycle and therefore two steps. Zero means the robot never put a foot
   * down twice — it stood, slid, or fell before completing a cycle.
   *
   * Behaviour, not quality. Nothing in `score` reads it; it is what the archive keys on.
   */
  readonly strideLength: number;
  /**
   * Fraction of the trial each foot spent on the ground, averaged over both feet.
   *
   * The textbook gait descriptor. Above 0.5 there is double support and it is walking;
   * below 0.5 there is a flight phase and it is running; at 1.0 it never lifted a foot.
   */
  readonly dutyFactor: number;
}

/** Weights for the default objective. Every term is separable and separately reported. */
export interface Objective {
  readonly distance: number;
  readonly upright: number;
  readonly effort: number;
  /** Joint travel, radians, above which the effort penalty starts to bite. */
  readonly effortBudget: number;
}

export const DEFAULT_OBJECTIVE: Objective = {
  distance: 1.0,
  upright: 0.5,
  effort: 0.3,
  effortBudget: 140,
};

export interface FitnessBreakdown {
  readonly total: number;
  readonly distance: number;
  readonly upright: number;
  readonly effort: number;
}

/**
 * Score a trial.
 *
 *   fitness = w_d * distance
 *           + w_u * (uprightTime / requestedDuration)
 *           - w_e * max(0, effort / effortBudget - 1)
 *
 * Defensive from the first line, on purpose. Distance alone reliably evolves a robot that
 * dives forward and lands on its face — §3 and §7 of the design document, where that
 * behaviour is eventually staged as a deliberate lesson rather than suppressed. Until
 * then the guards stay on.
 *
 * `requestedDuration` is the trial length that was asked for, not the length that ran. A
 * genome that falls at 1 s of a 4 s trial must score 0.25 on the upright term, not 1.0 —
 * dividing by the truncated duration would reward falling over quickly.
 */
export function score(
  result: TrialResult,
  requestedDuration: number,
  objective: Objective = DEFAULT_OBJECTIVE,
): FitnessBreakdown {
  const distance = objective.distance * result.distance;
  const upright = objective.upright * (result.uprightTime / requestedDuration);
  // Computed via the excess so an unpenalised trial reports +0 rather than -0. Negative
  // zero is harmless arithmetically and confusing in a printed breakdown.
  const excess = Math.max(0, result.effort / objective.effortBudget - 1);
  const effort = excess === 0 ? 0 : -objective.effort * excess;
  // Clamped at zero: negative fitness makes tournament selection compare noise, and a
  // genome that walks backwards is not more interesting than one that stands still.
  const total = Math.max(0, distance + upright + effort);
  return { total, distance, upright, effort };
}
