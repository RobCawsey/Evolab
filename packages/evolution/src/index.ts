export { Rng } from './rng.ts';
export { simpleBiped } from './morphology.ts';
export type { Morphology, Segment, Joint } from './morphology.ts';
export {
  gaitTargets,
  gaitPhase,
  defaultGait,
  withJointParam,
  GAIT_RANGES,
  JOINT_KINDS,
} from './controller.ts';
export type { GaitParams, JointGait, JointKind } from './controller.ts';
