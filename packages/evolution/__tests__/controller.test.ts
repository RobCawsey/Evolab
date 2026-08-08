import { describe, expect, it } from 'vitest';
import {
  GAIT_RANGES,
  PITCH_LEAD,
  STILL,
  defaultGait,
  gaitPhase,
  gaitTargets,
  simpleBiped,
  withJointParam,
  type GaitParams,
} from '@evolab/evolution';

const morph = simpleBiped();

const flat = (over: Partial<GaitParams> = {}): GaitParams => ({
  frequency: 1,
  balanceGain: 0,
  hip: { amplitude: 0, phase: 0, centre: 0 },
  knee: { amplitude: 0, phase: 0, centre: 0 },
  ankle: { amplitude: 0, phase: 0, centre: 0 },
  ...over,
});

describe('gaitTargets', () => {
  it('returns exactly one target per actuated joint', () => {
    const t = gaitTargets(morph, defaultGait(), 0);
    expect(t.size).toBe(morph.joints.length);
    for (const j of morph.joints) expect(t.has(j.id)).toBe(true);
  });

  it('clamps every target to the joint limits', () => {
    // Amplitudes and centres are sampled independently by the GA, so nothing stops it
    // proposing a target well outside a joint's range. Clamping here means the simulator
    // never receives an unreachable command.
    const wild = flat({
      hip: { amplitude: 50, phase: 0, centre: 40 },
      knee: { amplitude: 50, phase: 1, centre: -40 },
      ankle: { amplitude: 50, phase: 2, centre: 40 },
    });
    for (let t = 0; t < 4; t += 0.013) {
      const targets = gaitTargets(morph, wild, t);
      for (const j of morph.joints) {
        const v = targets.get(j.id)!;
        expect(v, `${j.id} at t=${t}`).toBeGreaterThanOrEqual(j.limits[0]);
        expect(v, `${j.id} at t=${t}`).toBeLessThanOrEqual(j.limits[1]);
      }
    }
  });

  it('is periodic at the gait frequency', () => {
    const p = defaultGait();
    const period = 1 / p.frequency;
    const a = gaitTargets(morph, p, 0.37);
    const b = gaitTargets(morph, p, 0.37 + period);
    for (const j of morph.joints) expect(b.get(j.id)!).toBeCloseTo(a.get(j.id)!, 10);
  });

  it('runs the two legs half a cycle apart', () => {
    const p = flat({ hip: { amplitude: 0.3, phase: 0, centre: 0 } });
    const period = 1;
    const now = gaitTargets(morph, p, 0.2);
    const half = gaitTargets(morph, p, 0.2 + period / 2);
    // The right hip, half a cycle later, should be where the left hip is now.
    expect(half.get('hipR')!).toBeCloseTo(now.get('hipL')!, 10);
  });

  it('leaves joints still when every amplitude is zero', () => {
    const p = flat({ hip: { amplitude: 0, phase: 0, centre: 0.2 } });
    for (const t of [0, 0.3, 1.7, 5]) {
      expect(gaitTargets(morph, p, t).get('hipL')!).toBeCloseTo(0.2, 10);
    }
  });

  it('reuses a supplied map without leaving stale entries', () => {
    // The control loop reuses one Map 60 times per simulated second, and millions of
    // times per run in slice 2. A stale key would send a joint a target from a previous
    // tick, which is the sort of bug that looks like a physics problem.
    const scratch = new Map<string, number>([['ghost', 123]]);
    const returned = gaitTargets(morph, defaultGait(), 0.5, STILL, scratch);
    expect(returned).toBe(scratch);
    expect(scratch.has('ghost')).toBe(false);
    expect(scratch.size).toBe(morph.joints.length);
  });

  describe('balance feedback', () => {
    it('is inert when the gain is zero', () => {
      const p = flat({ balanceGain: 0, hip: { amplitude: 0.2, phase: 0, centre: 0 } });
      const level = gaitTargets(morph, p, 0.4, { pitch: 0, pitchRate: 0 });
      const tipping = gaitTargets(morph, p, 0.4, { pitch: 0.3, pitchRate: 1.2 });
      for (const j of morph.joints) expect(tipping.get(j.id)!).toBeCloseTo(level.get(j.id)!, 12);
    });

    it('shifts the hips and nothing else', () => {
      const p = flat({ balanceGain: 1, knee: { amplitude: 0, phase: 0, centre: -0.2 } });
      const level = gaitTargets(morph, p, 0.4, { pitch: 0, pitchRate: 0 });
      const tipping = gaitTargets(morph, p, 0.4, { pitch: 0.2, pitchRate: 0 });
      expect(tipping.get('hipL')!).not.toBeCloseTo(level.get('hipL')!, 6);
      expect(tipping.get('kneeL')!).toBeCloseTo(level.get('kneeL')!, 12);
      expect(tipping.get('ankleL')!).toBeCloseTo(level.get('ankleL')!, 12);
    });

    it('applies gain x (pitch + lead x pitchRate)', () => {
      const gain = 1.5;
      const pitch = 0.1;
      const pitchRate = 0.4;
      const p = flat({ balanceGain: gain });
      const level = gaitTargets(morph, p, 0, { pitch: 0, pitchRate: 0 }).get('hipL')!;
      const fed = gaitTargets(morph, p, 0, { pitch, pitchRate }).get('hipL')!;
      expect(fed - level).toBeCloseTo(gain * (pitch + PITCH_LEAD * pitchRate), 10);
    });

    it('applies the same correction to both hips', () => {
      const p = flat({ balanceGain: 1.2 });
      const t = gaitTargets(morph, p, 0, { pitch: 0.15, pitchRate: 0 });
      expect(t.get('hipL')!).toBeCloseTo(t.get('hipR')!, 12);
    });
  });
});

describe('gaitPhase', () => {
  it('stays in [0, 1) and wraps once per cycle', () => {
    const p = defaultGait();
    for (let t = 0; t < 6; t += 0.017) {
      const v = gaitPhase(p, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(gaitPhase(p, 0)).toBeCloseTo(gaitPhase(p, 1 / p.frequency), 10);
  });
});

describe('withJointParam', () => {
  it('returns a new object and leaves the original untouched', () => {
    const before = defaultGait();
    const after = withJointParam(before, 'knee', 'amplitude', 0.77);
    expect(after.knee.amplitude).toBe(0.77);
    expect(before.knee.amplitude).toBe(defaultGait().knee.amplitude);
    expect(after.hip).toEqual(before.hip);
    expect(after).not.toBe(before);
  });
});

describe('defaultGait', () => {
  it('sits inside GAIT_RANGES on every parameter', () => {
    // The sliders and the slice-2 genome decode both derive from GAIT_RANGES. A default
    // outside them would render a slider pinned to its end and be unreachable by the GA.
    const p = defaultGait();
    const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
    expect(within(p.frequency, GAIT_RANGES.frequency)).toBe(true);
    expect(within(p.balanceGain, GAIT_RANGES.balanceGain)).toBe(true);
    for (const kind of ['hip', 'knee', 'ankle'] as const) {
      for (const key of ['amplitude', 'phase', 'centre'] as const) {
        expect(within(p[kind][key], GAIT_RANGES[kind][key]), `${kind}.${key}`).toBe(true);
      }
    }
  });

  it('is a fresh object each call', () => {
    expect(defaultGait()).not.toBe(defaultGait());
    expect(defaultGait()).toEqual(defaultGait());
  });
});
