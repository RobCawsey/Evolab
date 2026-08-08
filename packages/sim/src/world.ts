/**
 * Morphology -> Rapier world. This module owns Rapier and nothing else: it does not
 * render, and it does not know what a genome is (CLAUDE.md, invariant 4).
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { Morphology, Rng } from '@evolab/evolution';

/** Physics runs at a fixed timestep. Never step by frame delta. */
export const TIMESTEP = 1 / 240;

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
  /** Height of the torso centre, metres. Below ~55% of standing means it fell. */
  readonly torsoHeight: number;
  readonly fallen: boolean;
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
  private readonly morph: Morphology;
  private stepCount = 0;

  constructor(morph: Morphology, opts: SimOptions = {}) {
    if (!ready) {
      throw new Error('Call await initPhysics() before constructing a Sim.');
    }
    this.morph = morph;
    this.world = new RAPIER.World({ x: 0, y: opts.gravity ?? -9.81 });
    this.world.timestep = TIMESTEP;

    // Ground: a long, thin fixed slab whose top surface sits exactly at y = 0.
    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(60, 0.5).setFriction(1.0).setCollisionGroups(GROUND_GROUPS),
      groundBody,
    );

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
      params.limitsEnabled = true;
      params.limits = [j.limits[0], j.limits[1]];
      this.world.createImpulseJoint(params, parent, child, true);

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
    const torsoHeight = torso ? torso.translation().y : 0;

    return {
      time: this.stepCount * TIMESTEP,
      steps: this.stepCount,
      bodies,
      joints,
      torsoHeight,
      fallen: torsoHeight < 0.55 * this.morph.segments[0]!.y,
    };
  }

  /** Rapier allocates in WASM memory; a Sim that is dropped must be freed explicitly. */
  dispose(): void {
    this.world.free();
    this.bodies.clear();
    this.jointAnchors.length = 0;
  }
}

/**
 * Slice 0 helper: a biped with a small seeded initial lean, so it topples differently
 * for different seeds but identically for the same one.
 */
export function spawnFalling(morph: Morphology, rng: Rng): Sim {
  return new Sim(morph, { tilt: rng.range(-0.09, 0.09) });
}
