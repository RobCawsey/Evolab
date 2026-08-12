/**
 * Morphology -> Rapier world. This module owns Rapier and nothing else: it does not
 * render, and it does not know what a genome is (CLAUDE.md, invariant 4).
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { ControlState, Morphology, Rng } from '@evolab/evolution';
import {
  buildTerrain,
  FLAT,
  groundHeightAt,
  SAMPLE_SPACING,
  type Terrain,
  type TerrainSpec,
} from './terrain.ts';

/** Physics runs at a fixed timestep. Never step by frame delta. */
export const TIMESTEP = 1 / 240;

/**
 * Default position-motor gains.
 *
 * `MotorModel.AccelerationBased` makes the motor solve for acceleration rather than force,
 * so gains do not have to be re-scaled per limb inertia — one pair of numbers works for a
 * 6 kg torso and a 0.6 kg foot alike.
 *
 * These need to be far larger than a first guess suggests, and getting that wrong cost a
 * whole diagnostic session in slice 1. A motor is a spring, not a rigid link: under a
 * sustained gravitational moment it deflects, the deflection moves the centre of mass
 * further off the support, and that increases the moment. Below roughly k = 40 000 the
 * biped cannot hold a standing pose at all and topples in about a second — which reads
 * exactly like a fundamental limit of open-loop control, and is not one.
 *
 * Measured, holding the rest pose against a 0.03 rad initial tilt for 10 s:
 *
 *   k =  20 000  falls at 2.1 s
 *   k =  40 000  stands, but fails at a 0.08 rad tilt
 *   k =  80 000  stands at every tilt tried            <- chosen
 *   k = 100 000  stands, torso angle stays at 0.000
 *
 * Cross-checked against welded joints: replacing every revolute with a fixed joint, or
 * clamping the limits to (0, 0), also stands indefinitely. So the articulation is sound
 * and only the actuator authority was wrong.
 */
export const MOTOR_STIFFNESS = 80_000;
export const MOTOR_DAMPING = 8_000;

/**
 * Collision filtering: robot parts collide with the ground but never with each other.
 * Rapier packs membership in the high 16 bits and the filter mask in the low 16.
 */
const GROUP_GROUND = 0b0001;
const GROUP_ROBOT = 0b0010;
const GROUND_GROUPS = (GROUP_GROUND << 16) | 0xffff;
const ROBOT_GROUPS = (GROUP_ROBOT << 16) | GROUP_GROUND;

export interface BodyPose {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly layer: 'near' | 'far' | 'body';
}

export interface JointAnchor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Which leg this joint belongs to, so the renderer can lay out near and far limbs. */
  readonly layer: 'near' | 'far' | 'body';
}

export interface Snapshot {
  readonly time: number;
  readonly steps: number;
  readonly bodies: readonly BodyPose[];
  readonly joints: readonly JointAnchor[];
  /**
   * Height of the torso centre **above the ground beneath it**, metres. Below ~55% of
   * standing means it fell.
   *
   * Ground-relative since slice 14, and on flat ground identical to what it always was. An
   * absolute height would call a robot fallen halfway up a ramp and upright halfway down one.
   */
  readonly torsoHeight: number;
  /** Ground height under the torso, metres. Zero on flat ground. */
  readonly groundY: number;
  readonly fallen: boolean;
  /** Forward displacement of the torso from its spawn position, metres. */
  readonly distance: number;
  /** Actual joint angles relative to the rest pose, radians, keyed by joint id. */
  readonly jointAngles: ReadonlyMap<string, number>;
}

let ready = false;

/** Rapier's WASM must be initialised once per process before any other call. */
export async function initPhysics(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

export interface SimOptions {
  /** Initial forward lean in radians. A small tilt is what makes it topple. */
  readonly tilt?: number;
  readonly gravity?: number;
  readonly motorStiffness?: number;
  readonly motorDamping?: number;
  /**
   * The ground. Defaults to the flat floor every slice before 14 had.
   *
   * Flat is **not** a heightfield with two zeroes in it. A cuboid slab and a polyline generate
   * contacts differently enough to move the golden number, so flat ground keeps the collider
   * it has always had and terrain is the added case. Measured, not assumed — see the slice 14
   * notes.
   */
  readonly terrain?: TerrainSpec;
}

export class Sim {
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<string, RAPIER.RigidBody>();
  private readonly jointAnchors: {
    id: string;
    body: RAPIER.RigidBody;
    lx: number;
    ly: number;
    layer: 'near' | 'far' | 'body';
  }[] = [];
  /** Revolute joints that accept a position target, with the bodies needed to read back. */
  private readonly motors: {
    id: string;
    joint: RAPIER.RevoluteImpulseJoint;
    parent: RAPIER.RigidBody;
    child: RAPIER.RigidBody;
  }[] = [];
  private readonly morph: Morphology;
  private readonly stiffness: number;
  private readonly damping: number;
  private readonly spawnX: number;
  private readonly terrain: Terrain;
  private stepCount = 0;

  constructor(morph: Morphology, opts: SimOptions = {}) {
    if (!ready) {
      throw new Error('Call await initPhysics() before constructing a Sim.');
    }
    this.morph = morph;
    this.stiffness = opts.motorStiffness ?? MOTOR_STIFFNESS;
    this.damping = opts.motorDamping ?? MOTOR_DAMPING;
    this.world = new RAPIER.World({ x: 0, y: opts.gravity ?? -9.81 });
    this.world.timestep = TIMESTEP;

    this.terrain = buildTerrain(opts.terrain ?? FLAT);
    this.buildGround();

    const tilt = opts.tilt ?? 0;

    for (const s of morph.segments) {
      // Rotate the whole rest pose about the origin so the robot starts leaning.
      const cos = Math.cos(tilt);
      const sin = Math.sin(tilt);
      const x = s.x * cos - s.y * sin;
      const y = s.x * sin + s.y * cos;

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setRotation(tilt),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(s.halfWidth, s.halfHeight)
          .setDensity(s.density)
          .setFriction(0.9)
          .setRestitution(0.0)
          .setCollisionGroups(ROBOT_GROUPS),
        body,
      );
      this.bodies.set(s.id, body);
    }

    // Recorded after the tilt is applied, so distance is measured from where the robot
    // actually started rather than from the untilted rest pose.
    this.spawnX = this.bodies.get('torso')?.translation().x ?? 0;

    for (const j of morph.joints) {
      const parent = this.bodies.get(j.parent);
      const child = this.bodies.get(j.child);
      if (!parent || !child) {
        throw new Error(`Joint ${j.id} references a missing segment`);
      }
      const params = RAPIER.JointData.revolute(
        { x: j.parentAnchor[0], y: j.parentAnchor[1] },
        { x: j.childAnchor[0], y: j.childAnchor[1] },
      );
      // createImpulseJoint returns the base class; limits and motors live on the revolute
      // specialisation, so this cast is necessary and safe — we asked for a revolute
      // joint on the line above.
      const handle = this.world.createImpulseJoint(params, parent, child, true) as RAPIER.RevoluteImpulseJoint;

      // Limits MUST be applied to the created joint, not to the JointData. Setting
      // `params.limitsEnabled` / `params.limits` before creation is silently ignored for
      // 2D revolute joints in Rapier 0.14 — the joint comes back with limitsEnabled()
      // false and bounds of ±3.4e38. Slice 0 did it that way, so the biped had no joint
      // limits at all and its knees bent both ways.
      handle.setLimits(j.limits[0], j.limits[1]);
      handle.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      this.motors.push({ id: j.id, joint: handle, parent, child });

      const childSeg = morph.segments.find((s) => s.id === j.child);
      this.jointAnchors.push({
        id: j.id,
        body: parent,
        lx: j.parentAnchor[0],
        ly: j.parentAnchor[1],
        layer: childSeg?.layer ?? 'body',
      });
    }
  }

  /** Advance one fixed timestep. */
  step(): void {
    this.world.step();
    this.stepCount++;
  }

  /** Advance by a number of steps. */
  stepMany(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  get steps(): number {
    return this.stepCount;
  }

  get time(): number {
    return this.stepCount * TIMESTEP;
  }

  /**
   * What the controller is allowed to sense: which way the torso is leaning and how fast.
   *
   * Deliberately separate from `snapshot()`, which allocates arrays and maps for the
   * renderer. This runs 60 times per simulated second and, from slice 2, millions of times
   * per run — it must stay allocation-free apart from the returned pair.
   *
   * Rapier's rotation is anticlockwise-positive, so a torso leaning forward (its top
   * moving towards +x) has a negative rotation. Pitch negates it, so that positive means
   * falling forward and the balance gain reads as a corrective term.
   */
  /**
   * The floor.
   *
   * Flat ground is a long thin slab whose top surface sits exactly at y = 0 — what every slice
   * before 14 built, kept byte for byte because a polyline and a cuboid do not generate
   * identical contacts and the golden number is measured on this one.
   *
   * Everything else is a Rapier heightfield over the same `Float32Array` that
   * `groundHeightAt` reads. In 2D a heightfield spans `scale.x` centred on the collider, so
   * the translation puts sample 0 at `terrain.x0`.
   */
  private buildGround(): void {
    const spec = this.terrain.spec;

    // Flat ground is built **exactly** as it was before slice 14: the rigid body carries the
    // −0.5 offset and the collider sits at its local origin.
    //
    // Not fussiness. Moving that same offset onto the collider instead is geometrically
    // identical and numerically is not — it takes a different floating-point path through the
    // solver, and it moved the golden number from 6.4598 to 5.8015. Terrain is added beside
    // this case, never over it.
    if (spec.kind === 'flat') {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(60, 0.5).setFriction(1.0).setCollisionGroups(GROUND_GROUPS),
        body,
      );
      return;
    }

    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const add = (desc: RAPIER.ColliderDesc): void => {
      this.world.createCollider(
        desc.setFriction(1.0).setCollisionGroups(GROUND_GROUPS),
        body,
      );
    };

    switch (spec.kind) {

      case 'ramp': {
        // One slab, rotated. Exact rather than sampled, and with no seam anywhere along it,
        // which is why a 0° ramp is the flat slab rather than merely close to it.
        //
        // The slab's top surface passes through the origin at angle a: take the centre `half`
        // along the slope from there, then half a thickness down the slope normal.
        const a = (spec.degrees * Math.PI) / 180;
        const half = spec.length / 2;
        add(
          RAPIER.ColliderDesc.cuboid(half, 0.5)
            .setTranslation(half * Math.cos(a) + 0.5 * Math.sin(a), half * Math.sin(a) - 0.5 * Math.cos(a))
            .setRotation(a),
        );
        // A level approach, so the robot always spawns flat whatever it is about to climb.
        add(RAPIER.ColliderDesc.cuboid(4, 0.5).setTranslation(-4, -0.5));
        return;
      }

      case 'steps': {
        // One slab per tread, each thick enough that its centre sits at y = -0.5 whatever its
        // top is — so the bottom is always well below the world and only the top face matters.
        add(RAPIER.ColliderDesc.cuboid((spec.start + 4) / 2, 0.5)
          .setTranslation((spec.start - 4) / 2, -0.5));
        for (let n = 1; n <= spec.count; n++) {
          const x = spec.start + (n - 1) * spec.tread;
          const width = n === spec.count ? spec.length - x : spec.tread;
          const top = n * spec.rise;
          add(
            RAPIER.ColliderDesc.cuboid(width / 2, (top + 1) / 2)
              .setTranslation(x + width / 2, top - (top + 1) / 2),
          );
        }
        return;
      }

      case 'rough': {
        // A chain of rotated slabs, one per sample — **not** a Rapier heightfield.
        //
        // A heightfield generates a contact point per segment under the collider: twenty of
        // them beneath a 16 cm foot, against two for a cuboid. Measured, that over-constrained
        // manifold is not a nuance — five independently evolved gaits walked a mean 2.84 m on
        // flat ground and 0.64 m on a *geometrically identical* flat heightfield, with 5/5
        // falling, and varying the amplitude from 0 to 4 cm barely moved the number. The task
        // would have measured the collider rather than the terrain.
        const { heights, x0 } = this.terrain;
        for (let i = 0; i < heights.length - 1; i++) {
          const y0 = heights[i]!;
          const y1 = heights[i + 1]!;
          const a = Math.atan2(y1 - y0, SAMPLE_SPACING);
          const len = Math.hypot(SAMPLE_SPACING, y1 - y0);
          // Centre of a slab whose top face runs from (x0+i·s, y0) to the next sample.
          const cx = x0 + i * SAMPLE_SPACING + SAMPLE_SPACING / 2;
          const cy = (y0 + y1) / 2;
          add(
            RAPIER.ColliderDesc.cuboid(len / 2, 0.5)
              .setTranslation(cx + 0.5 * Math.sin(a), cy - 0.5 * Math.cos(a))
              .setRotation(a),
          );
        }
        return;
      }
    }
  }

  /**
   * Ground height under a world x — the one question the fall and contact tests ask.
   *
   * Reads the same array the collider was built from, so the two cannot drift apart. If they
   * ever did, the robot would float or sink with nothing on screen to explain it.
   */
  groundAt(x: number): number {
    return groundHeightAt(this.terrain, x);
  }

  /**
   * Shove the torso — §6's Shove task, redefined as a fore/aft impulse.
   *
   * "Lateral" has nowhere to point in a sagittal simulation. A push along x tests the same
   * thing the task is for, which is whether an open-loop gait can recover from a disturbance
   * it never saw during evolution, and tests it harder: the robot has to catch itself with the
   * legs it actually has rather than by widening its stance.
   */
  applyTorsoImpulse(x: number): void {
    this.bodies.get('torso')?.applyImpulse({ x, y: 0 }, true);
  }

  controlState(): ControlState {
    const torso = this.bodies.get('torso');
    if (!torso) return { pitch: 0, pitchRate: 0 };
    return { pitch: -torso.rotation(), pitchRate: -torso.angvel() };
  }

  /**
   * Apply position targets to the joint motors. The simulator applies numbers; it does
   * not decide them — targets come from a controller in `packages/evolution`, already
   * clamped to the joint limits.
   */
  setJointTargets(targets: ReadonlyMap<string, number>): void {
    for (const m of this.motors) {
      const target = targets.get(m.id);
      if (target === undefined) continue;
      m.joint.configureMotorPosition(target, this.stiffness, this.damping);
    }
  }

  /** Relax every motor, so the robot goes back to being a ragdoll. */
  clearJointTargets(): void {
    for (const m of this.motors) m.joint.configureMotorPosition(0, 0, 0);
  }

  snapshot(): Snapshot {
    const bodies: BodyPose[] = [];
    for (const s of this.morph.segments) {
      const body = this.bodies.get(s.id);
      if (!body) continue;
      const t = body.translation();
      bodies.push({
        id: s.id,
        x: t.x,
        y: t.y,
        angle: body.rotation(),
        halfWidth: s.halfWidth,
        halfHeight: s.halfHeight,
        layer: s.layer,
      });
    }

    const joints: JointAnchor[] = this.jointAnchors.map((a) => {
      const t = a.body.translation();
      const r = a.body.rotation();
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      return {
        id: a.id,
        x: t.x + a.lx * cos - a.ly * sin,
        y: t.y + a.lx * sin + a.ly * cos,
        layer: a.layer,
      };
    });

    const torso = this.bodies.get('torso');
    // Height above the ground *here*, not above y = 0. On flat ground groundY is zero and this
    // is exactly what it always was; on an 18° ramp an absolute height would rise 6.5 m over
    // twenty metres and the fall test would never fire.
    const groundY = torso ? this.groundAt(torso.translation().x) : 0;
    const torsoHeight = torso ? torso.translation().y - groundY : 0;

    // In 2D a body's rotation is a scalar, so a revolute joint's angle is simply the
    // difference between child and parent rotations — zero in the rest pose, which is
    // what the morphology's limits are expressed relative to.
    const jointAngles = new Map<string, number>();
    for (const m of this.motors) {
      jointAngles.set(m.id, m.child.rotation() - m.parent.rotation());
    }

    return {
      time: this.stepCount * TIMESTEP,
      steps: this.stepCount,
      bodies,
      joints,
      torsoHeight,
      groundY,
      fallen: torsoHeight < 0.55 * this.morph.segments[0]!.y,
      distance: torso ? torso.translation().x - this.spawnX : 0,
      jointAngles,
    };
  }

  /** Rapier allocates in WASM memory; a Sim that is dropped must be freed explicitly. */
  dispose(): void {
    this.world.free();
    this.bodies.clear();
    this.jointAnchors.length = 0;
    this.motors.length = 0;
  }
}

/**
 * Slice 0 helper: a biped with a small seeded initial lean, so it topples differently
 * for different seeds but identically for the same one.
 */
export function spawnFalling(morph: Morphology, rng: Rng): Sim {
  return new Sim(morph, { tilt: rng.range(-0.09, 0.09) });
}
