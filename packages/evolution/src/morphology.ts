/**
 * What a robot *is*, independent of physics and rendering.
 *
 * All units SI: metres, kilograms, radians. Origin is the ground plane at y = 0, y-up.
 * `packages/sim` turns one of these into a Rapier world; nothing here knows Rapier exists.
 */

export interface Segment {
  readonly id: string;
  /** Half-extents of the box, in metres. Rapier's cuboid convention. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** Centre position in the rest pose, metres. */
  readonly x: number;
  readonly y: number;
  readonly density: number;
  /** Purely for rendering: near-side limbs draw brighter than far-side ones. */
  readonly layer: 'near' | 'far' | 'body';
}

export interface Joint {
  readonly id: string;
  /** Which kind of joint this is. The controller has one parameter set per kind. */
  readonly kind: 'hip' | 'knee' | 'ankle';
  /** Which leg. Left and right run half a gait cycle apart. */
  readonly side: 'L' | 'R';
  readonly parent: string;
  readonly child: string;
  /** Anchor in the parent's local frame, metres. */
  readonly parentAnchor: readonly [number, number];
  /** Anchor in the child's local frame, metres. */
  readonly childAnchor: readonly [number, number];
  /** Rotation limits in radians, relative to the rest pose. */
  readonly limits: readonly [number, number];
  /** Peak motor torque, N·m. Unused in slice 0 — there is no controller yet. */
  readonly maxTorque: number;
}

export interface Morphology {
  readonly name: string;
  readonly segments: readonly Segment[];
  readonly joints: readonly Joint[];
  /** Height of the torso top in the rest pose, metres. Used to detect a fall. */
  readonly standingHeight: number;
}

/* ---------------- the editable body ---------------- */

/**
 * A biped described by its dimensions rather than by absolute coordinates.
 *
 * This is what the body editor edits. Deriving positions and joint anchors from lengths
 * means **the kinematic chain closes by construction** — there is no way to drag a segment
 * somewhere that leaves a joint pulling two bodies together on the first step. The
 * morphology test that asserts anchor agreement can never fail from a user edit, only from
 * a bug in `buildBiped`.
 *
 * The topology is fixed: seven segments, six joints, always symmetric. That is a real
 * limitation and it buys something large — the joint count never changes, so the genome
 * stays eleven genes and **an evolved gait can be transplanted onto a modified body**.
 * Making the legs longer and watching a gait that used to work fall over is the single most
 * instructive thing this editor can offer, and a variable-topology editor would have made
 * it impossible.
 */
export interface BipedSpec {
  /** Torso length is head-to-hip; width is front-to-back in the sagittal plane. */
  readonly torso: { readonly length: number; readonly width: number };
  readonly thigh: { readonly length: number; readonly width: number };
  readonly shank: { readonly length: number; readonly width: number };
  readonly foot: {
    readonly length: number;
    readonly height: number;
    /** How far forward of the ankle the foot's centre sits. Heel-to-toe balance. */
    readonly ankleOffset: number;
  };
  /** Areal density, kg/m². See the note on DENSITY below. */
  readonly density: number;
  readonly limits: {
    readonly hip: readonly [number, number];
    readonly knee: readonly [number, number];
    readonly ankle: readonly [number, number];
  };
  readonly maxTorque: { readonly hip: number; readonly knee: number; readonly ankle: number };
}

const DEG = Math.PI / 180;

/**
 * Areal density, kg/m².
 *
 * Rapier's 2D world computes mass as `density × area`, not `density × volume` — the
 * simulation is a slice through a body of unit depth. So this is a 3D density of
 * 1000 kg/m³ (roughly water, roughly flesh) multiplied by a limb depth of 0.13 m.
 *
 * Slice 0 used 1000 here, which silently built a 163 kg biped. Motors could still hold
 * it because they are acceleration-based, but every torque figure was meaningless and
 * it toppled like a felled tree. Total mass is now ≈21 kg, matching §3 of the design
 * document and making the `maxTorque` values plausible.
 */
const DENSITY = 130;

/** The reference biped. `buildBiped(DEFAULT_SPEC)` reproduces the slice-0 morphology exactly. */
export const DEFAULT_SPEC: BipedSpec = {
  torso: { length: 0.36, width: 0.18 },
  thigh: { length: 0.26, width: 0.09 },
  shank: { length: 0.25, width: 0.07 },
  foot: { length: 0.16, height: 0.05, ankleOffset: 0.03 },
  density: DENSITY,
  limits: {
    hip: [-50 * DEG, 90 * DEG],
    knee: [-132 * DEG, 8 * DEG],
    ankle: [-35 * DEG, 25 * DEG],
  },
  maxTorque: { hip: 120, knee: 88, ankle: 60 },
};

/** Editable ranges, for the editor's sliders. Also the bounds `clampSpec` enforces. */
export const SPEC_RANGES = {
  torso: { length: [0.15, 0.6], width: [0.08, 0.32] },
  thigh: { length: [0.12, 0.45], width: [0.04, 0.16] },
  shank: { length: [0.12, 0.45], width: [0.03, 0.14] },
  foot: { length: [0.08, 0.34], height: [0.02, 0.1], ankleOffset: [-0.06, 0.12] },
  density: [40, 400],
} as const;

function clamp(v: number, [lo, hi]: readonly [number, number]): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Bring a spec inside `SPEC_RANGES`. Anything loaded from a URL goes through this. */
export function clampSpec(spec: BipedSpec): BipedSpec {
  return {
    torso: {
      length: clamp(spec.torso.length, SPEC_RANGES.torso.length),
      width: clamp(spec.torso.width, SPEC_RANGES.torso.width),
    },
    thigh: {
      length: clamp(spec.thigh.length, SPEC_RANGES.thigh.length),
      width: clamp(spec.thigh.width, SPEC_RANGES.thigh.width),
    },
    shank: {
      length: clamp(spec.shank.length, SPEC_RANGES.shank.length),
      width: clamp(spec.shank.width, SPEC_RANGES.shank.width),
    },
    foot: {
      length: clamp(spec.foot.length, SPEC_RANGES.foot.length),
      height: clamp(spec.foot.height, SPEC_RANGES.foot.height),
      ankleOffset: clamp(spec.foot.ankleOffset, SPEC_RANGES.foot.ankleOffset),
    },
    density: clamp(spec.density, SPEC_RANGES.density),
    limits: spec.limits,
    maxTorque: spec.maxTorque,
  };
}

/**
 * Spec → Morphology. Everything is derived bottom-up from the ground, so the feet always
 * rest exactly on y = 0 and every joint anchor pair describes the same world point.
 */
export function buildBiped(spec: BipedSpec = DEFAULT_SPEC): Morphology {
  const { torso, thigh, shank, foot } = spec;

  // Stack upward from the ground: foot, ankle, shank, knee, thigh, hip, torso.
  const footY = foot.height / 2;
  const ankleY = foot.height;
  const shankY = ankleY + shank.length / 2;
  const kneeY = ankleY + shank.length;
  const thighY = kneeY + thigh.length / 2;
  const hipY = kneeY + thigh.length;
  const torsoY = hipY + torso.length / 2;

  const seg: Segment[] = [
    {
      id: 'torso',
      halfWidth: torso.width / 2,
      halfHeight: torso.length / 2,
      x: 0,
      y: torsoY,
      density: spec.density,
      layer: 'body',
    },
  ];
  const joints: Joint[] = [];

  // Right leg is drawn behind the torso, left leg in front, so the gait reads clearly.
  const legs = [
    { side: 'L' as const, layer: 'near' as const },
    { side: 'R' as const, layer: 'far' as const },
  ];

  for (const { side, layer } of legs) {
    seg.push(
      {
        id: `thigh${side}`, halfWidth: thigh.width / 2, halfHeight: thigh.length / 2,
        x: 0, y: thighY, density: spec.density, layer,
      },
      {
        id: `shank${side}`, halfWidth: shank.width / 2, halfHeight: shank.length / 2,
        x: 0, y: shankY, density: spec.density, layer,
      },
      {
        id: `foot${side}`, halfWidth: foot.length / 2, halfHeight: foot.height / 2,
        x: foot.ankleOffset, y: footY, density: spec.density, layer,
      },
    );
    joints.push(
      {
        id: `hip${side}`, kind: 'hip', side,
        parent: 'torso', child: `thigh${side}`,
        parentAnchor: [0, -torso.length / 2],
        childAnchor: [0, thigh.length / 2],
        limits: spec.limits.hip,
        maxTorque: spec.maxTorque.hip,
      },
      {
        id: `knee${side}`, kind: 'knee', side,
        parent: `thigh${side}`, child: `shank${side}`,
        parentAnchor: [0, -thigh.length / 2],
        childAnchor: [0, shank.length / 2],
        limits: spec.limits.knee,
        maxTorque: spec.maxTorque.knee,
      },
      {
        id: `ankle${side}`, kind: 'ankle', side,
        parent: `shank${side}`, child: `foot${side}`,
        parentAnchor: [0, -shank.length / 2],
        childAnchor: [-foot.ankleOffset, foot.height / 2],
        limits: spec.limits.ankle,
        maxTorque: spec.maxTorque.ankle,
      },
    );
  }

  return {
    name: 'biped',
    segments: seg,
    joints,
    standingHeight: hipY + torso.length,
  };
}

/** The default 2D sagittal biped: 7 segments, 6 actuated joints, 0.92 m tall, ≈21 kg. */
export function simpleBiped(): Morphology {
  return buildBiped(DEFAULT_SPEC);
}

/* ---------------- measurements and validation ---------------- */

export interface BodyStats {
  readonly mass: number;
  readonly standingHeight: number;
  /** Centre of mass x in the rest pose. Must sit over the feet or it cannot stand. */
  readonly comX: number;
  /** Support span from heel to toe, metres. */
  readonly support: readonly [number, number];
  /** Margin from the centre of mass to the nearer edge of the foot. Negative means it tips. */
  readonly margin: number;
  /** Peak gravitational torque at the hip, as a fraction of the hip's torque budget. */
  readonly hipLoad: number;
}

export function bodyStats(morph: Morphology): BodyStats {
  let mass = 0;
  let mx = 0;
  for (const s of morph.segments) {
    const m = 2 * s.halfWidth * 2 * s.halfHeight * s.density;
    mass += m;
    mx += m * s.x;
  }
  const comX = mass > 0 ? mx / mass : 0;
  const foot = morph.segments.find((s) => s.id === 'footL');
  const support: [number, number] = foot
    ? [foot.x - foot.halfWidth, foot.x + foot.halfWidth]
    : [0, 0];
  const margin = Math.min(comX - support[0], support[1] - comX);

  // Roughly what the hip must hold when the torso is horizontal: the worst case a gait can
  // ask for. A ratio over 1 means the joint cannot lift its own upper body.
  const torso = morph.segments.find((s) => s.id === 'torso');
  const hip = morph.joints.find((j) => j.kind === 'hip');
  const torsoMass = torso ? 2 * torso.halfWidth * 2 * torso.halfHeight * torso.density : 0;
  const hipLoad = hip && torso ? (torsoMass * 9.81 * torso.halfHeight) / hip.maxTorque : 0;

  return { mass, standingHeight: morph.standingHeight, comX, support, margin, hipLoad };
}

export interface Issue {
  readonly level: 'error' | 'warning';
  readonly text: string;
}

/**
 * Things worth telling the user before they spend eight seconds evolving a body that
 * cannot work. Chain closure is deliberately absent: `buildBiped` makes it impossible.
 */
export function validateBody(morph: Morphology): Issue[] {
  const issues: Issue[] = [];
  const stats = bodyStats(morph);

  if (stats.margin <= 0) {
    issues.push({
      level: 'error',
      text: 'The centre of mass is outside the feet — it will topple before it can take a step.',
    });
  } else if (stats.margin < 0.015) {
    issues.push({
      level: 'warning',
      text: `Only ${(stats.margin * 1000).toFixed(0)} mm of balance margin. Expect it to tip easily.`,
    });
  }

  if (stats.hipLoad > 1) {
    issues.push({
      level: 'error',
      text: 'The hips cannot lift this torso. Shorten it, lighten it, or raise the hip torque.',
    });
  } else if (stats.hipLoad > 0.7) {
    issues.push({
      level: 'warning',
      text: 'The hips are close to their torque limit holding the torso up.',
    });
  }

  for (const j of morph.joints) {
    if (j.limits[0] >= j.limits[1]) {
      issues.push({ level: 'error', text: `${j.id} has a degenerate range of motion.` });
    } else if (j.limits[0] > 0 || j.limits[1] < 0) {
      issues.push({
        level: 'error',
        text: `${j.id} cannot reach its own rest pose — limits must span zero.`,
      });
    }
  }

  const legLength = stats.standingHeight;
  if (legLength > 1.6) {
    issues.push({ level: 'warning', text: 'Very tall. Taller bipeds fall faster and are harder to evolve.' });
  }

  return issues;
}