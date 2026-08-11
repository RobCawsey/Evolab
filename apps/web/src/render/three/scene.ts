/**
 * The 3D replay — §9 of the design document, Fig 9.1.
 *
 * **This is the only file in the project that imports Three.js**, and it is only ever
 * reached through a dynamic `import()` from `main.ts`. Three is about 600 kB and the guided
 * flow never opens the 3D view, so it must not be in the first paint. That constraint is
 * also a test of the render layer: if this module could not be split out, something below
 * `apps/web` would have reached up into it.
 *
 * The geometry decisions all live next door in `bodies.ts`, which imports nothing from here
 * and is tested under Node. This file is the part that can only be verified by looking at it.
 *
 * **The physics is still 2D and the view does not hide it.** Orbit to the front and the
 * robot visibly cannot fall sideways, because nothing in the eleven-gene genome moves in
 * that axis. That is a decision, recorded in the slice 9 notes, not an oversight.
 */

import * as THREE from 'three';
import type { Snapshot } from '@evolab/sim';
import { focusPoint, layoutBodies, type BoxInstance } from './bodies.ts';

/** Maximum boxes the instanced mesh can draw. Seven for the biped, headroom for slice 10's ghosts. */
const MAX_INSTANCES = 64;

const COLOURS = {
  background: 0x0d0c14,
  ground: 0x1b1a26,
  grid: 0x322f42,
  gridCentre: 0x4c4868,
  torso: 0xc9c5d8,
  near: 0x4ea8c4,
  far: 0x2f6f86,
} as const;

export interface OrbitState {
  /** Radians around the vertical axis. Zero looks along +x, the direction of travel. */
  azimuth: number;
  /** Radians above the horizon, clamped short of the poles. */
  elevation: number;
  /** Metres from the target. */
  distance: number;
}

export interface ThreeView {
  /** Draw one snapshot. Called from the existing fixed-timestep loop; owns no clock. */
  render(snap: Snapshot): void;
  resize(width: number, height: number): void;
  /** Point the camera back at the default three-quarter view. */
  resetCamera(): void;
  readonly orbit: OrbitState;
  dispose(): void;
}

export function createThreeView(canvas: HTMLCanvasElement): ThreeView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOURS.background);
  // Far enough back that the grid stays legible around the robot and only the horizon
  // fades. Fogging at 6 m put the haze inside the working area.
  scene.fog = new THREE.Fog(COLOURS.background, 10, 34);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);

  // Two lights and no shadow map. A grey box robot on a grid reads better for teaching than
  // a styled one, and shadows on an instanced mesh are a session of work for no clarity.
  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x24212f, 2.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 6, 4);
  scene.add(key);

  // Wide enough that the edge is never on screen, and short enough across that the grid
  // still reads as a corridor the robot is walking down rather than an infinite void.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 24),
    new THREE.MeshStandardMaterial({ color: COLOURS.ground, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // The grid is what makes distance legible — a robot on a featureless plane looks stationary
  // however fast it is going. One metre per division, matching the 2D view's ground hatching.
  const grid = new THREE.GridHelper(400, 400, COLOURS.gridCentre, COLOURS.grid);
  grid.position.y = 0.001;
  scene.add(grid);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.05 });
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);

  const orbit: OrbitState = { azimuth: 0, elevation: 0, distance: 0 };
  const DEFAULT_ORBIT: OrbitState = { azimuth: -0.62, elevation: 0.28, distance: 3.4 };
  Object.assign(orbit, DEFAULT_ORBIT);

  // Scratch objects, reused every frame. Allocating a Matrix4 and a Quaternion per body per
  // frame is the classic way to make a 60 Hz scene stutter every few seconds on GC.
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 0, 1);
  const colour = new THREE.Color();
  const target = new THREE.Vector3(0, 0.7, 0);
  let boxes: BoxInstance[] = [];
  let coloured = false;

  function applyCamera(): void {
    const ce = Math.cos(orbit.elevation);
    camera.position.set(
      target.x + orbit.distance * Math.cos(orbit.azimuth) * ce,
      target.y + orbit.distance * Math.sin(orbit.elevation),
      target.z + orbit.distance * Math.sin(orbit.azimuth) * ce,
    );
    camera.lookAt(target);
  }

  return {
    orbit,

    render(snap: Snapshot): void {
      boxes = layoutBodies(snap, boxes);

      for (let i = 0; i < boxes.length && i < MAX_INSTANCES; i++) {
        const b = boxes[i]!;
        position.set(b.x, b.y, b.z);
        quaternion.setFromAxisAngle(axis, b.angle);
        scale.set(b.sx, b.sy, b.sz);
        mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));

        // Tinted once. Near and far legs differ so the gait reads at a glance — the same job
        // FAR_LEG_RENDER_OFFSET does in 2D, done here with colour instead of a fudge.
        if (!coloured) {
          const layerColour = b.id === 'torso' ? COLOURS.torso
            : b.z > 0 ? COLOURS.near
            : b.z < 0 ? COLOURS.far
            : COLOURS.torso;
          mesh.setColorAt(i, colour.setHex(layerColour));
        }
      }
      mesh.count = Math.min(boxes.length, MAX_INSTANCES);
      mesh.instanceMatrix.needsUpdate = true;
      if (!coloured && mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
        coloured = true;
      }

      // The camera trails the torso in x only. Following y as well would make a stumble look
      // like the world moving rather than the robot falling.
      //
      // Smooth while walking, but **snap on a jump**. Scrubbing to 5 s moves the robot eight
      // metres between one frame and the next, and a camera that eases into that spends half
      // a second showing empty grid — which is exactly what it did the first time, and reads
      // as the seek having broken rather than the camera being polite.
      const focus = focusPoint(snap);
      target.x = Math.abs(focus.x - target.x) > 1.5
        ? focus.x
        : target.x + (focus.x - target.x) * 0.12;
      applyCamera();

      renderer.render(scene, camera);
    },

    resize(width: number, height: number): void {
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    resetCamera(): void {
      Object.assign(orbit, DEFAULT_ORBIT);
      applyCamera();
    },

    /**
     * **Nothing calls this yet, and that is the correct state of affairs.**
     *
     * The view is created once and lives for the session: it reads a `Snapshot` every frame
     * and holds no morphology, so even the body editor cannot invalidate it. Toggling back
     * to 2D deliberately keeps it alive rather than paying 600 kB of scene setup again.
     *
     * It exists because Three leaks GPU memory as enthusiastically as Rapier leaks WASM
     * memory, and the first thing that *does* tear a scene down — slice 10 rebuilding the
     * mesh for ghost overlays — will need it. Writing it now, while the allocation sites are
     * in front of us, is cheaper than reconstructing the list later.
     */
    dispose(): void {
      geometry.dispose();
      material.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
