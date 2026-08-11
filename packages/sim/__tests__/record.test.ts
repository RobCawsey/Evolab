import { beforeAll, describe, expect, it } from 'vitest';
import { Rng, decodeGenome, simpleBiped } from '@evolab/evolution';
import {
  CONTROL_EVERY,
  RECORD_HZ,
  Sim,
  TIMESTEP,
  contactAt,
  dutyFromRecording,
  dutyPerFoot,
  evaluate,
  initPhysics,
  snapshotAt,
  stepControlled,
  timeAt,
} from '@evolab/sim';

const morph = simpleBiped();

/** The reference champion — seed 4417, 30 generations, the gait behind the golden 6.4598. */
const CHAMPION = Float32Array.from([
  0.468684, 0.639280, 0.861243, 0.339522, 0.937122, 0.078753,
  0.725578, 0.780452, 0.626414, 0.682012, 0.477553,
]);

beforeAll(async () => {
  await initPhysics();
});

describe('recording a trial', () => {
  it('does not change what the trial measured', () => {
    // The one guarantee that matters. If observing the trajectory perturbed the simulation,
    // every recorded replay would be of a run that never happened — and the discrepancy
    // would be small enough to look like a rendering bug for a very long time.
    const plain = evaluate(morph, CHAMPION, { seed: 3, seconds: 4 });
    const taped = evaluate(morph, CHAMPION, { seed: 3, seconds: 4, record: true });

    expect(taped.distance).toBe(plain.distance);
    expect(taped.uprightTime).toBe(plain.uprightTime);
    expect(taped.effort).toBe(plain.effort);
    expect(taped.strideLength).toBe(plain.strideLength);
    expect(taped.dutyFactor).toBe(plain.dutyFactor);
    expect(taped.fell).toBe(plain.fell);
  });

  it('carries no recording when it was not asked for', () => {
    // `record` unset is the path the search takes tens of thousands of times per study.
    const plain = evaluate(morph, CHAMPION, { seed: 3, seconds: 4 });
    expect('recording' in plain).toBe(false);
  });

  it('samples at 60 Hz for the whole trial', () => {
    const { recording } = evaluate(morph, CHAMPION, { seed: 0, seconds: 4, record: true });
    expect(recording.hz).toBe(RECORD_HZ);
    // 4 s at 60 Hz, inclusive of both ends.
    expect(recording.frames).toBe(241);
    expect(timeAt(recording, 240)).toBeCloseTo(4, 10);
    expect(recording.bodies).toEqual([
      'torso', 'thighL', 'shankL', 'footL', 'thighR', 'shankR', 'footR',
    ]);
    expect(recording.joints).toHaveLength(morph.joints.length);
  });

  it('replays the same positions the simulation had', () => {
    // The strong version of the claim: a recorded frame is not an approximation of the
    // trajectory, it *is* the trajectory. A fresh sim driven the same way has to land on the
    // same numbers at the same instants, or the scrubber shows something that never happened
    // — and the discrepancy would be small enough to look like a rendering bug for months.
    const SEED = 0;
    const SECONDS = 2;
    const { recording } = evaluate(morph, CHAMPION, { seed: SEED, seconds: SECONDS, record: true });

    // Reproduce evaluate's spawn exactly: same seed, same default tilt range.
    const sim = new Sim(morph, { tilt: new Rng(SEED).range(-0.02, 0.02) });
    const params = decodeGenome(CHAMPION);
    const scratch = new Map<string, number>();
    try {
      for (let frame = 0; frame < recording.frames; frame++) {
        const live = sim.snapshot();
        const taped = snapshotAt(recording, frame);

        expect(taped.time).toBeCloseTo(live.time, 9);
        for (let i = 0; i < live.bodies.length; i++) {
          const a = live.bodies[i]!;
          const b = taped.bodies[i]!;
          expect(b.id).toBe(a.id);
          // Float32 storage, so exact equality is not available — but 1e-6 m is a micron.
          expect(b.x).toBeCloseTo(a.x, 5);
          expect(b.y).toBeCloseTo(a.y, 5);
          expect(b.angle).toBeCloseTo(a.angle, 5);
        }
        expect(taped.distance).toBeCloseTo(live.distance, 5);
        expect(taped.torsoHeight).toBeCloseTo(live.torsoHeight, 5);
        for (const [id, angle] of live.jointAngles) {
          expect(taped.jointAngles.get(id)!).toBeCloseTo(angle, 5);
        }

        stepControlled(sim, morph, params, CONTROL_EVERY, scratch);
      }
    } finally {
      sim.dispose();
    }
  });

  it('reconstructs half-extents and layers, so the 2D renderer can draw a recorded frame', () => {
    // This is what lets one scrubber drive both views: both take a Snapshot, so neither has
    // to know a recording exists.
    const { recording } = evaluate(morph, CHAMPION, { seed: 0, seconds: 1, record: true });
    const s = snapshotAt(recording, 30);
    const torso = s.bodies.find((b) => b.id === 'torso')!;
    const footL = s.bodies.find((b) => b.id === 'footL')!;
    expect(torso.layer).toBe('body');
    expect(footL.layer).toBe('near');
    expect(footL.halfWidth).toBeCloseTo(0.08, 6);
    expect(s.joints).toHaveLength(morph.joints.length);
    expect(s.joints[0]!.id).toBe('hipL');
  });

  it('clamps a seek past either end instead of returning holes', () => {
    const { recording } = evaluate(morph, CHAMPION, { seed: 0, seconds: 1, record: true });
    expect(snapshotAt(recording, -50).time).toBe(0);
    expect(snapshotAt(recording, 99999).time).toBeCloseTo(
      (recording.frames - 1) / RECORD_HZ, 10,
    );
  });

  it('records foot contact, and it agrees with the duty factor', () => {
    // Same measurement the behaviour archive keys on, sampled at 60 Hz instead of 240.
    //
    // `dutyFromRecording` is the function slice 10's footfall diagram prints, so this is the
    // test that stops the diagram claiming one duty while the map beside it claims another.
    // Counted by hand here as well, because a function agreeing with itself proves nothing.
    const trial = evaluate(morph, CHAMPION, { seed: 0, seconds: 4, record: true });
    const rec = trial.recording;
    let stance = 0;
    for (let f = 0; f < rec.frames; f++) {
      if (contactAt(rec, f, 0)) stance++;
      if (contactAt(rec, f, 1)) stance++;
    }
    const byHand = stance / (rec.frames * 2);

    expect(dutyFromRecording(rec)).toBeCloseTo(byHand, 12);

    // Against the trial's own figure the agreement is close but not exact, and the gap is
    // real rather than a bug: the trial counts stance at 240 Hz and the recording stores it
    // at 60 Hz, so a touchdown landing between samples is rounded to the nearest frame.
    // Bounded explicitly at one percentage point — `toBeCloseTo(_, 2)` allows 0.005 and the
    // measured gap is 0.0047, which would make this test fail on a breeze rather than on a
    // regression.
    expect(Math.abs(dutyFromRecording(rec) - trial.dutyFactor)).toBeLessThan(0.01);
  });

  it('splits duty per foot, so an asymmetric gait is not hidden by the average', () => {
    const trial = evaluate(morph, CHAMPION, { seed: 0, seconds: 4, record: true });
    const [left, right] = dutyPerFoot(trial.recording);
    // The mean of the two feet is the combined figure, by construction.
    expect((left + right) / 2).toBeCloseTo(dutyFromRecording(trial.recording), 12);
    // This champion walks, so both feet spend real time in the air and real time down.
    for (const d of [left, right]) {
      expect(d).toBeGreaterThan(0.3);
      expect(d).toBeLessThan(1);
    }
  });

  it('reports zero rather than dividing by zero on an empty recording', () => {
    const empty = { ...evaluate(morph, CHAMPION, { seed: 0, seconds: 1, record: true }).recording, frames: 0 };
    expect(dutyFromRecording(empty)).toBe(0);
    expect(dutyPerFoot(empty)).toEqual([0, 0]);
  });

  it('trims to the frames it actually captured when the robot falls early', () => {
    // A trial that fell at 1 s of 4 must not hand the renderer three seconds of zeroes and
    // a scrubber that seeks into them.
    const flailing = Float32Array.from([
      0.95, 0.05, 0.9, 0.1, 0.9, 0.9, 0.2, 0.9, 0.9, 0.5, 0.1,
    ]);
    const trial = evaluate(morph, flailing, { seed: 11, seconds: 4, record: true });
    const rec = trial.recording;
    expect(trial.fell).toBe(true);
    expect(rec.frames).toBeLessThan(241);
    expect(rec.frames).toBeGreaterThan(0);
    // Every buffer is trimmed to the same frame count — no trailing zeroes anywhere.
    expect(rec.pose).toHaveLength(rec.frames * rec.bodies.length * 3);
    expect(rec.anchors).toHaveLength(rec.frames * rec.joints.length * 2);
    expect(rec.jointAngles).toHaveLength(rec.frames * rec.joints.length);
    expect(rec.contact).toHaveLength(rec.frames * 2);
    expect(rec.distance).toHaveLength(rec.frames);
    expect(rec.torsoHeight).toHaveLength(rec.frames);
  });

  it('samples on control ticks, not between them', () => {
    // 240 Hz physics, 60 Hz control, 60 Hz recording. A recorded frame lands on a tick where
    // the joint targets had just been set, rather than midway through the motors chasing
    // them — which is what makes slice 10's joint-angle traces line up with the commands.
    expect(Math.round(1 / TIMESTEP / RECORD_HZ)).toBe(CONTROL_EVERY);
  });
});
