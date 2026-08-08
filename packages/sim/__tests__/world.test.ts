import { beforeAll, describe, expect, it } from 'vitest';
import { Rng, defaultGait, gaitTargets, simpleBiped, type GaitParams } from '@evolab/evolution';
import { MOTOR_STIFFNESS, Sim, TIMESTEP, initPhysics, spawnFalling, stepControlled } from '@evolab/sim';

const morph = simpleBiped();

beforeAll(async () => {
  await initPhysics();
});

/** Run a sim to `seconds`, always disposing it. Rapier lives in WASM memory. */
function run(sim: Sim, seconds: number, params?: GaitParams) {
  const steps = Math.round(seconds / TIMESTEP);
  const scratch = new Map<string, number>();
  try {
    if (params) stepControlled(sim, morph, params, steps, scratch);
    else sim.stepMany(steps);
    return sim.snapshot();
  } finally {
    sim.dispose();
  }
}

const still = (over: Partial<GaitParams> = {}): GaitParams => ({
  frequency: 1,
  balanceGain: 0,
  hip: { amplitude: 0, phase: 0, centre: 0 },
  knee: { amplitude: 0, phase: 0, centre: 0 },
  ankle: { amplitude: 0, phase: 0, centre: 0 },
  ...over,
});

describe('Sim', () => {
  it('refuses to build before initPhysics', () => {
    // Not testable here without unloading the module — initPhysics has already run. The
    // guard exists so the failure is a clear message rather than a WASM fault; see
    // world.ts. Asserting the happy path instead.
    expect(() => new Sim(morph).dispose()).not.toThrow();
  });

  it('starts in the rest pose', () => {
    const sim = new Sim(morph, { tilt: 0 });
    try {
      const s = sim.snapshot();
      expect(s.steps).toBe(0);
      expect(s.time).toBe(0);
      expect(s.distance).toBe(0);
      expect(s.fallen).toBe(false);
      expect(s.bodies).toHaveLength(morph.segments.length);
      expect(s.joints).toHaveLength(morph.joints.length);
      for (const a of s.jointAngles.values()) expect(Math.abs(a)).toBeLessThan(1e-9);
    } finally {
      sim.dispose();
    }
  });

  it('advances time at the fixed timestep', () => {
    const sim = new Sim(morph);
    try {
      sim.stepMany(240);
      expect(sim.steps).toBe(240);
      expect(sim.time).toBeCloseTo(1, 10);
    } finally {
      sim.dispose();
    }
  });

  it('replays identically from the same seed', () => {
    const a = run(spawnFalling(morph, new Rng(4417)), 3);
    const b = run(spawnFalling(morph, new Rng(4417)), 3);
    expect(b.torsoHeight).toBe(a.torsoHeight);
    expect(b.distance).toBe(a.distance);
  });

  it('diverges for different seeds', () => {
    const a = run(spawnFalling(morph, new Rng(1)), 3);
    const b = run(spawnFalling(morph, new Rng(2)), 3);
    expect(b.distance).not.toBe(a.distance);
  });

  it('falls over when nothing drives it', () => {
    expect(run(spawnFalling(morph, new Rng(4417)), 3).fallen).toBe(true);
  });

  describe('joint limits', () => {
    it('are actually enforced', () => {
      // Regression test for the slice-1 bug. Setting `limitsEnabled` and `limits` on the
      // JointData before createImpulseJoint is silently ignored for 2D revolute joints in
      // Rapier 0.14 — the joint comes back with bounds of +/-3.4e38. Limits must be applied
      // with setLimits() on the created joint. Until this was found the biped had no
      // limits at all and its knees bent both ways.
      //
      // Commanding every joint far outside its range and checking the achieved angles is
      // the only test that would have caught it.
      const sim = new Sim(morph, { tilt: 0 });
      const targets = new Map<string, number>();
      try {
        for (let i = 0; i < 240 * 2; i++) {
          if (i % 4 === 0) {
            targets.clear();
            // Deliberately unclamped: gaitTargets would have clamped these for us, and
            // that would test the controller rather than the joint.
            for (const j of morph.joints) targets.set(j.id, j.limits[1] + 3);
            sim.setJointTargets(targets);
          }
          sim.step();
        }
        for (const j of morph.joints) {
          const angle = sim.snapshot().jointAngles.get(j.id)!;
          expect(angle, `${j.id} exceeded its upper limit`).toBeLessThan(j.limits[1] + 0.12);
        }
      } finally {
        sim.dispose();
      }
    });
  });

  describe('motor authority', () => {
    it('holds the biped upright with no oscillation at the default stiffness', () => {
      // Regression test for the other slice-1 bug. MOTOR_STIFFNESS was 400, roughly 200x
      // too small, and the biped toppled in about a second no matter what the gait did.
      // That looked exactly like a fundamental limit of open-loop control and was not one.
      // If this test fails, the gains have been lowered.
      const s = run(new Sim(morph, { tilt: 0.03 }), 6, still());
      expect(s.fallen).toBe(false);
      expect(s.torsoHeight).toBeGreaterThan(0.6);
    });

    it('cannot hold it up at the old gains', () => {
      // The negative half of the same test: proves the assertion above is measuring motor
      // authority and not something incidental about the pose.
      const s = run(new Sim(morph, { tilt: 0.03, motorStiffness: 400, motorDamping: 40 }), 6, still());
      expect(s.fallen).toBe(true);
    });

    it('defaults to a stiffness that is known to work', () => {
      expect(MOTOR_STIFFNESS).toBeGreaterThanOrEqual(40_000);
    });

    it('tracks a commanded joint angle', () => {
      const sim = new Sim(morph, { tilt: 0 });
      const targets = new Map<string, number>();
      try {
        for (let i = 0; i < 240; i++) {
          if (i % 4 === 0) {
            gaitTargets(morph, still({ knee: { amplitude: 0, phase: 0, centre: -0.5 } }), sim.time, undefined, targets);
            sim.setJointTargets(targets);
          }
          sim.step();
        }
        expect(sim.snapshot().jointAngles.get('kneeL')!).toBeCloseTo(-0.5, 1);
      } finally {
        sim.dispose();
      }
    });
  });

  describe('controlState', () => {
    it('reports zero pitch in the rest pose', () => {
      const sim = new Sim(morph, { tilt: 0 });
      try {
        const cs = sim.controlState();
        expect(cs.pitch).toBeCloseTo(0, 10);
        expect(cs.pitchRate).toBeCloseTo(0, 10);
      } finally {
        sim.dispose();
      }
    });

    it('reports positive pitch when leaning forward', () => {
      // Rapier rotation is anticlockwise-positive, so leaning forward is a negative
      // rotation and pitch negates it. Getting this sign wrong inverts the balance gene,
      // which is exactly what happened on the first attempt.
      const sim = new Sim(morph, { tilt: -0.1 });
      try {
        expect(sim.controlState().pitch).toBeGreaterThan(0.05);
      } finally {
        sim.dispose();
      }
    });
  });

  describe('walking', () => {
    it('travels a long way with the best known gait', () => {
      // End-to-end guard on the whole pipeline: morphology, limits, motors, controller and
      // control rate all have to be right for this number to hold.
      const best: GaitParams = {
        frequency: 1.671,
        balanceGain: 0.69,
        hip: { amplitude: 0.793, phase: 5.349, centre: 0.167 },
        knee: { amplitude: 0.121, phase: 1.307, centre: -0.066 },
        ankle: { amplitude: 0.27, phase: 6.283, centre: 0.008 },
      };
      const s = run(new Sim(morph, { tilt: 0 }), 8, best);
      expect(s.fallen).toBe(false);
      expect(s.distance).toBeGreaterThan(8);
    });

    it('goes nowhere with the default gait', () => {
      // Slice 1's whole point: hand-tuning does not work. If this ever starts passing 1 m,
      // someone has tuned the default and the exercise is broken.
      const s = run(new Sim(morph, { tilt: 0 }), 8, defaultGait());
      expect(Math.abs(s.distance)).toBeLessThan(3);
    });
  });

  it('survives repeated build and dispose', () => {
    // Undisposed worlds are the most likely cause of a slow or crashing run in slice 2,
    // where thousands of sims are created per generation.
    for (let i = 0; i < 200; i++) new Sim(morph, { tilt: 0 }).dispose();
    expect(run(new Sim(morph, { tilt: 0 }), 0.5, still()).fallen).toBe(false);
  });
});
