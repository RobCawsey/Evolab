export { Rng } from './rng.ts';
export {
  simpleBiped,
  buildBiped,
  clampSpec,
  bodyStats,
  validateBody,
  DEFAULT_SPEC,
  SPEC_RANGES,
} from './morphology.ts';
export type { Morphology, Segment, Joint, BipedSpec, BodyStats, Issue } from './morphology.ts';

export {
  gaitTargets,
  gaitPhase,
  defaultGait,
  withJointParam,
  decodeGenome,
  encodeGenome,
  GAIT_RANGES,
  GENE_NAMES,
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
export type { GeneChange } from './operators.ts';

export {
  createArchive,
  archiveInsert,
  archivePlace,
  archiveIndex,
  archiveCoverage,
  archiveBest,
  archiveQd,
  archiveMerge,
  behaviourOf,
  binOf,
  DEFAULT_STRIDE_AXIS,
  DEFAULT_DUTY_AXIS,
} from './archive.ts';
export type { Archive, ArchiveAxis, ArchiveCell } from './archive.ts';

export { score, DEFAULT_OBJECTIVE } from './fitness.ts';
export type { TrialResult, Objective, FitnessBreakdown } from './fitness.ts';

export {
  createIsland,
  generation,
  stepGeneration,
  evaluatePending,
  completeGeneration,
  pendingCount,
  emigrants,
  immigrate,
  evolve,
  DEFAULT_CONFIG,
} from './island.ts';
export type {
  Island, IslandConfig, Individual, GenerationSummary, Evaluator,
  Stage, GenerationOptions, TournamentTrace, CrossoverTrace,
} from './island.ts';
