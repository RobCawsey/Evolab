export { Rng } from './rng.ts';
export { simpleBiped } from './morphology.ts';
export type { Morphology, Segment, Joint } from './morphology.ts';

export {
  gaitTargets,
  gaitPhase,
  defaultGait,
  withJointParam,
  decodeGenome,
  encodeGenome,
  GAIT_RANGES,
  GENOME_LENGTH,
  JOINT_KINDS,
  PITCH_LEAD,
  STILL,
} from './controller.ts';
export type { GaitParams, JointGait, JointKind, ControlState, Genome } from './controller.ts';

export {
  randomGenome,
  tournament,
  sbx,
  mutate,
  diversity,
  SBX_ETA,
  MUTATION_ETA,
} from './operators.ts';

export { score, DEFAULT_OBJECTIVE } from './fitness.ts';
export type { TrialResult, Objective, FitnessBreakdown } from './fitness.ts';

export { createIsland, stepGeneration, evolve, DEFAULT_CONFIG } from './island.ts';
export type { Island, IslandConfig, Individual, GenerationSummary, Evaluator } from './island.ts';
