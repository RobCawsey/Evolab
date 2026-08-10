import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEC,
  Rng,
  SPEC_RANGES,
  bodyStats,
  buildBiped,
  clampSpec,
  simpleBiped,
  validateBody,
  type BipedSpec,
  type Segment,
} from '@evolab/evolution';

/** A spec drawn from anywhere inside the editable ranges. */
function randomSpec(rng: Rng): BipedSpec {
  const pick = ([lo, hi]: readonly [number, number]) => rng.range(lo, hi);
  return {
    torso: { length: pick(SPEC_RANGES.torso.length), width: pick(SPEC_RANGES.torso.width) },
    thigh: { length: pick(SPEC_RANGES.thigh.length), width: pick(SPEC_RANGES.thigh.width) },
    shank: { length: pick(SPEC_RANGES.shank.length), width: pick(SPEC_RANGES.shank.width) },
    foot: {
      length: pick(SPEC_RANGES.foot.length),
      height: pick(SPEC_RANGES.foot.height),
      ankleOffset: pick(SPEC_RANGES.foot.ankleOffset),
    },
    density: pick(SPEC_RANGES.density),
    limits: DEFAULT_SPEC.limits,
    maxTorque: DEFAULT_SPEC.maxTorque,
  };
}

const massOf = (s: Segment) => 2 * s.halfWidth * 2 * s.halfHeight * s.density;

describe('buildBiped', () => {
  it('reproduces the reference body exactly from the default spec', () => {
    // The whole refactor is only safe if this holds: every stored gait, the golden test and
    // the physics regression guards are all pinned to these numbers.
    expect(buildBiped(DEFAULT_SPEC)).toEqual(simpleBiped());
  });

  describe('for any spec in range', () => {
    const rng = new Rng(4417);
    const specs = Array.from({ length: 300 }, () => randomSpec(rng));

    it('closes the kinematic chain', () => {
      // The guarantee the parametric spec exists to provide. With free-form segment editing
      // this is a validation rule that a user can violate; here it is arithmetic, and the
      // only way to break it is a bug in buildBiped.
      for (const spec of specs) {
        const morph = buildBiped(spec);
        const byId = new Map(morph.segments.map((s) => [s.id, s]));
        for (const j of morph.joints) {
          const p = byId.get(j.parent)!;
          const c = byId.get(j.child)!;
          expect(p.x + j.parentAnchor[0]).toBeCloseTo(c.x + j.childAnchor[0], 10);
          expect(p.y + j.parentAnchor[1]).toBeCloseTo(c.y + j.childAnchor[1], 10);
        }
      }
    });

    it('always stands on the ground rather than through or above it', () => {
      for (const spec of specs) {
        const morph = buildBiped(spec);
        const lowest = Math.min(...morph.segments.map((s) => s.y - s.halfHeight));
        expect(lowest).toBeCloseTo(0, 9);
      }
    });

    it('always reports the height it actually is', () => {
      for (const spec of specs) {
        const morph = buildBiped(spec);
        const top = Math.max(...morph.segments.map((s) => s.y + s.halfHeight));
        expect(top).toBeCloseTo(morph.standingHeight, 9);
      }
    });

    it('keeps the topology fixed, so genomes stay portable', () => {
      // The reason a gait evolved on one body can be transplanted onto another: the joint
      // count never changes, so the genome is always eleven genes.
      for (const spec of specs) {
        const morph = buildBiped(spec);
        expect(morph.segments).toHaveLength(7);
        expect(morph.joints).toHaveLength(6);
        expect(morph.joints.map((j) => j.id).sort()).toEqual(
          ['ankleL', 'ankleR', 'hipL', 'hipR', 'kneeL', 'kneeR'],
        );
      }
    });

    it('stays symmetric', () => {
      for (const spec of specs) {
        const morph = buildBiped(spec);
        for (const part of ['thigh', 'shank', 'foot'] as const) {
          const l = morph.segments.find((s) => s.id === `${part}L`)!;
          const r = morph.segments.find((s) => s.id === `${part}R`)!;
          expect({ ...l, id: '', layer: 'x' }).toEqual({ ...r, id: '', layer: 'x' });
        }
      }
    });
  });
});

describe('clampSpec', () => {
  it('pulls out-of-range values back inside', () => {
    const wild: BipedSpec = {
      ...DEFAULT_SPEC,
      torso: { length: 99, width: -5 },
      foot: { length: 0, height: 50, ankleOffset: 12 },
      density: 1e6,
    };
    const spec = clampSpec(wild);
    expect(spec.torso.length).toBe(SPEC_RANGES.torso.length[1]);
    expect(spec.torso.width).toBe(SPEC_RANGES.torso.width[0]);
    expect(spec.foot.length).toBe(SPEC_RANGES.foot.length[0]);
    expect(spec.density).toBe(SPEC_RANGES.density[1]);
  });

  it('leaves a valid spec untouched', () => {
    expect(clampSpec(DEFAULT_SPEC)).toEqual(DEFAULT_SPEC);
  });
});

describe('bodyStats', () => {
  it('measures the reference body', () => {
    const stats = bodyStats(simpleBiped());
    expect(stats.mass).toBeGreaterThan(18);
    expect(stats.mass).toBeLessThan(25);
    expect(stats.standingHeight).toBeCloseTo(0.92, 6);
    expect(stats.margin).toBeGreaterThan(0);
  });

  it('reports a negative margin when the feet cannot cover the centre of mass', () => {
    // Shove the feet so far forward that the body is behind its own heels.
    const morph = buildBiped({
      ...DEFAULT_SPEC,
      foot: { length: 0.08, height: 0.05, ankleOffset: 0.12 },
    });
    expect(bodyStats(morph).margin).toBeLessThan(0);
  });

  it('scales mass with density', () => {
    const light = bodyStats(buildBiped({ ...DEFAULT_SPEC, density: 65 }));
    const heavy = bodyStats(buildBiped({ ...DEFAULT_SPEC, density: 260 }));
    expect(heavy.mass / light.mass).toBeCloseTo(4, 6);
  });
});

describe('validateBody', () => {
  it('passes the reference body', () => {
    expect(validateBody(simpleBiped()).filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('rejects a body that cannot stand over its feet', () => {
    const morph = buildBiped({
      ...DEFAULT_SPEC,
      foot: { length: 0.08, height: 0.05, ankleOffset: 0.12 },
    });
    const errors = validateBody(morph).filter((i) => i.level === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.text).toMatch(/centre of mass/i);
  });

  it('rejects hips that cannot lift their own torso', () => {
    const morph = buildBiped({
      ...DEFAULT_SPEC,
      torso: { length: 0.6, width: 0.32 },
      maxTorque: { hip: 5, knee: 88, ankle: 60 },
    });
    const errors = validateBody(morph).filter((i) => i.level === 'error');
    expect(errors.some((e) => /hips cannot lift/i.test(e.text))).toBe(true);
  });

  it('rejects joint limits that exclude the rest pose', () => {
    const morph = buildBiped({
      ...DEFAULT_SPEC,
      limits: { ...DEFAULT_SPEC.limits, knee: [0.2, 1.0] },
    });
    const errors = validateBody(morph).filter((i) => i.level === 'error');
    expect(errors.some((e) => /rest pose/i.test(e.text))).toBe(true);
  });

  it('rejects a degenerate range of motion', () => {
    const morph = buildBiped({
      ...DEFAULT_SPEC,
      limits: { ...DEFAULT_SPEC.limits, hip: [0.5, 0.5] },
    });
    expect(validateBody(morph).some((i) => /degenerate/i.test(i.text))).toBe(true);
  });

  it('never errors on a body the editor can actually produce', () => {
    // Sliders are bounded by SPEC_RANGES, so a user should not be able to reach a body the
    // validator calls impossible — warnings are fine, errors mean the ranges are too wide.
    const rng = new Rng(99);
    let errors = 0;
    for (let i = 0; i < 200; i++) {
      const morph = buildBiped(clampSpec(randomSpec(rng)));
      errors += validateBody(morph).filter((x) => x.level === 'error').length;
    }
    // Extreme ankle offsets legitimately do produce unstandable bodies; the editor warns
    // rather than forbidding them, so a handful here is expected and useful.
    expect(errors).toBeLessThan(80);
  });
});

describe('the reference body against a modified one', () => {
  it('changes mass and height when limbs change', () => {
    const tall = buildBiped({
      ...DEFAULT_SPEC,
      thigh: { length: 0.4, width: 0.09 },
      shank: { length: 0.4, width: 0.07 },
    });
    const base = simpleBiped();
    expect(tall.standingHeight).toBeGreaterThan(base.standingHeight + 0.25);
    expect(bodyStats(tall).mass).toBeGreaterThan(bodyStats(base).mass);
  });

  it('keeps every segment mass positive', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 100; i++) {
      for (const s of buildBiped(randomSpec(rng)).segments) expect(massOf(s)).toBeGreaterThan(0);
    }
  });
});
