import { beforeAll, describe, expect, it } from 'vitest';
import { Rng, decodeGenome, defaultGait, gaitTargets, simpleBiped, type GaitParams } from '@evolab/evolution';
import { MOTOR_STIFFNESS, Sim, TIMESTEP, evaluate, evaluateGait, initPhysics, spawnFalling, stepControlled } from '@evolab/sim';

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

describe('gait descriptors', () => {
  // Stride length and duty factor are what the behaviour archive keys on, and unlike
  // fitness nothing selects for them — so if they are wrong, nothing else in the project
  // goes red. These are the only thing standing between a plausible-looking map and a map
  // that means nothing.

  it('reports a statue as never striding and always in stance', () => {
    // Zero amplitude everywhere: the feet are planted at t = 0 and never move. Duty must be
    // exactly 1 and there can be no stride, because a stride is one touchdown to the next.
    const r = evaluateGait(morph, still(), { seed: 0, seconds: 2, tiltRange: 0 });
    expect(r.fell).toBe(false);
    expect(r.dutyFactor).toBe(1);
    expect(r.strideLength).toBe(0);
  });

  it('measures a real walk against the distance it covered', () => {
    // The reference champion — seed 4417, 30 generations, the gait behind the golden 6.4598.
    const champion = Float32Array.from([
      0.468684, 0.639280, 0.861243, 0.339522, 0.937122, 0.078753,
      0.725578, 0.780452, 0.626414, 0.682012, 0.477553,
    ]);
    const r = evaluate(morph, champion, { seed: 0, seconds: 4 });

    expect(r.fell).toBe(false);
    expect(r.distance).toBeCloseTo(5.96, 1);
    expect(r.strideLength).toBeCloseTo(0.923, 2);
    expect(r.dutyFactor).toBeCloseTo(0.80, 2);

    // The independent check: this gait steps about 1.6 times a second for 4 seconds, so
    // stride × cycles has to come back to the distance actually travelled. A descriptor
    // that did not close this loop would be measuring something other than a stride.
    const cycles = r.distance / r.strideLength;
    expect(cycles).toBeGreaterThan(5);
    expect(cycles).toBeLessThan(8);

    // Between 0.5 and 1 it is walking with double support. Below 0.5 there is a flight
    // phase, and this morphology does not run.
    expect(r.dutyFactor).toBeGreaterThan(0.5);
    expect(r.dutyFactor).toBeLessThan(1);
  });

  it('is insensitive to the exact contact threshold', () => {
    // The threshold was swept before it was chosen: touchdowns are a flat 7 per foot from
    // 1 mm to 10 mm. This asserts the consequence — that the champion's feet clear the
    // ground by centimetres, so no plausible epsilon changes the answer. If a physics or
    // morphology change ever shrinks that clearance, the descriptors quietly become
    // threshold-dependent and this is what says so.
    const sim = new Sim(morph, { tilt: 0 });
    const params = decodeGenome(Float32Array.from([
      0.468684, 0.639280, 0.861243, 0.339522, 0.937122, 0.078753,
      0.725578, 0.780452, 0.626414, 0.682012, 0.477553,
    ]));
    const scratch = new Map<string, number>();
    let peakClearance = 0;
    try {
      for (let i = 0; i < Math.round(4 / TIMESTEP); i++) {
        stepControlled(sim, morph, params, 1, scratch);
        for (const b of sim.snapshot().bodies) {
          if (b.id !== 'footL' && b.id !== 'footR') continue;
          const low =
            b.y - (Math.abs(b.halfWidth * Math.sin(b.angle)) +
                   Math.abs(b.halfHeight * Math.cos(b.angle)));
          if (low > peakClearance) peakClearance = low;
        }
      }
    } finally {
      sim.dispose();
    }
    expect(peakClearance).toBeGreaterThan(0.04);
  });
});
