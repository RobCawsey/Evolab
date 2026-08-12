export {
  Sim,
  initPhysics,
  spawnFalling,
  TIMESTEP,
  MOTOR_STIFFNESS,
  MOTOR_DAMPING,
} from './world.ts';
export type { Snapshot, BodyPose, JointAnchor, SimOptions } from './world.ts';
export { stepControlled, CONTROL_EVERY } from './control.ts';
export { evaluate, evaluateGait, makeEvaluator } from './evaluate.ts';
export type { TrialOptions, RecordedTrial } from './evaluate.ts';
export {
  createRecorder, snapshotAt, contactAt, dutyFromRecording, dutyPerFoot, timeAt, RECORD_HZ,
} from './record.ts';
export type { Recording, Recorder } from './record.ts';
export { buildTerrain, groundHeightAt, maxSlope, FLAT, SAMPLE_SPACING } from './terrain.ts';
export type { Terrain, TerrainSpec } from './terrain.ts';
