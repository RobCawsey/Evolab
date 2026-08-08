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

/**
 * The default 2D sagittal biped: 7 segments, 6 actuated joints.
 *
 * Dimensions chosen so the rest pose stands 0.92 m tall with the feet flat on y = 0 —
 * close enough to the design document's 0.94 m reference biped. Do not tune these to
 * make walking easier (see CLAUDE.md); that is the genetic algorithm's job.
 */
export function simpleBiped(): Morphology {
  const seg: Segment[] = [
    { id: 'torso', halfWidth: 0.09, halfHeight: 0.18, x: 0, y: 0.74, density: DENSITY, layer: 'body' },
  ];
  const joints: Joint[] = [];

  // Right leg is drawn behind the torso, left leg in front, so the gait reads clearly.
  const legs = [
    { side: 'L' as const, dx: 0.0, layer: 'near' as const },
    { side: 'R' as const, dx: 0.0, layer: 'far' as const },
  ];

  for (const { side, dx, layer } of legs) {
    seg.push(
      { id: `thigh${side}`, halfWidth: 0.045, halfHeight: 0.13, x: dx, y: 0.43, density: DENSITY, layer },
      { id: `shank${side}`, halfWidth: 0.035, halfHeight: 0.125, x: dx, y: 0.175, density: DENSITY, layer },
      { id: `foot${side}`, halfWidth: 0.08, halfHeight: 0.025, x: dx + 0.03, y: 0.025, density: DENSITY, layer },
    );
    joints.push(
      {
        id: `hip${side}`,
        kind: 'hip',
        side,
        parent: 'torso',
        child: `thigh${side}`,
        parentAnchor: [dx, -0.18],
        childAnchor: [0, 0.13],
        limits: [-50 * DEG, 90 * DEG],
        maxTorque: 120,
      },
      {
        id: `knee${side}`,
        kind: 'knee',
        side,
        parent: `thigh${side}`,
        child: `shank${side}`,
        parentAnchor: [0, -0.13],
        childAnchor: [0, 0.125],
        limits: [-132 * DEG, 8 * DEG],
        maxTorque: 88,
      },
      {
        id: `ankle${side}`,
        kind: 'ankle',
        side,
        parent: `shank${side}`,
        child: `foot${side}`,
        parentAnchor: [0, -0.125],
        childAnchor: [-0.03, 0.025],
        limits: [-35 * DEG, 25 * DEG],
        maxTorque: 60,
      },
    );
  }

  return { name: 'simple-biped', segments: seg, joints, standingHeight: 0.92 };
}
