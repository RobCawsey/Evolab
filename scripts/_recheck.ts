import { buildBiped, DEFAULT_SPEC, type GaitParams } from '../packages/evolution/src/index.ts';
import { evaluateGait, initPhysics } from '../packages/sim/src/index.ts';

await initPhysics();
const morph = buildBiped(DEFAULT_SPEC);
const p = '1.999,0.777,0.741,2.585,0.181,0.120,4.538,-0.044,0.335,4.526,-0.015'.split(',').map(Number);
const gait: GaitParams = {
  frequency: p[0]!, balanceGain: p[1]!,
  hip: { amplitude: p[2]!, phase: p[3]!, centre: p[4]! },
  knee: { amplitude: p[5]!, phase: p[6]!, centre: p[7]! },
  ankle: { amplitude: p[8]!, phase: p[9]!, centre: p[10]! },
};

console.log('               distance  upright  effort   stride    duty');
for (const [label, opts] of [
  ['seed 4417 plain', { seed: 4417, seconds: 4 }],
  ['seed 4417 record', { seed: 4417, seconds: 4, record: true as const }],
] as const) {
  const r = evaluateGait(morph, gait, opts as never);
  console.log(`${label.padEnd(16)} ${r.distance.toFixed(4).padStart(7)} ${r.uprightTime.toFixed(2).padStart(7)}` +
    ` ${r.effort.toFixed(1).padStart(7)} ${r.strideLength.toFixed(4).padStart(8)} ${r.dutyFactor.toFixed(4).padStart(7)}`);
}
console.log('stored           4.9722    4.00    53.7   1.1000  0.8725');
