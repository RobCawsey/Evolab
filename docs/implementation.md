# Evolab — Implementation Guide

How Evolab is built, slice by slice. For each stage: what it does, what it touches, the
data structures and algorithms involved, and how you know it is finished.

**Companion document:** [technical-design.html](technical-design.html) — the architecture
and UI specification. That document answers *why*; this one answers *how*, and *in what
order*. Where they disagree, the design document wins and this one is stale.

**Audience:** a developer who has not seen the project before and needs to pick up any
slice and implement it. Every section is meant to be actionable without reading the code
first.

---

## Contents

- [How to use this document](#how-to-use-this-document)
- [Ground rules](#ground-rules)
- [Module map](#module-map)
- [Slice index](#slice-index)
- **Slice 0** — [It falls over](#slice-0--it-falls-over) *(complete)*
- **Slice 1** — [It walks, badly](#slice-1--it-walks-badly) *(complete — read
  [the motor stiffness trap](#the-motor-stiffness-trap))*
- **Slice 2** — [The GA finds a gait](#slice-2--the-ga-finds-a-gait) *(complete)*
- **Slice 3** — [You can watch it](#slice-3--you-can-watch-it) *(complete)*
- **Slice 4** — [Off the main thread](#slice-4--off-the-main-thread) *(complete)*
- **Slice 5** — [The stepper](#slice-5--the-stepper) *(complete)*
- **Slice 6** — [Guided first run](#slice-6--guided-first-run) *(complete)*
- **Slice 7** — [Body editor](#slice-7--body-editor) *(complete)*
- **Slice 8** — [Behaviour archive](#slice-8--behaviour-archive)
- **Slices 9–14** — [Later stages](#slices-914--later-stages)
- [Appendix A — Rapier notes](#appendix-a--rapier-notes)
- [Appendix B — Genome layouts](#appendix-b--genome-layouts)

---

## How to use this document

Each slice has the same seven headings:

| Heading | What it contains |
|---|---|
| **Goal** | One sentence. The observable change. |
| **Depends on** | Which slices must exist first. |
| **Design** | Data structures, algorithms, formulas. The substance. |
| **Files** | What is created or changed. |
| **Implementation notes** | Gotchas, API details, decisions already made. |
| **Done when** | Concrete, checkable acceptance criteria. |
| **Deliberately not in this slice** | Scope fence. Read this one twice. |

### Detail decays with distance, on purpose

Slices 0–4 are specified tightly: signatures, formulas, constants. Slices 5–8 are specified
at the level of structure and approach. Slices 9–14 are sketches.

This is deliberate. A precise specification for slice 12 written today would be wrong by
the time it is built, and worse, it would look authoritative. **Each slice is written out
in full detail at the end of the slice before it**, when the shape of the code is known.
Updating this document is part of finishing a slice.

### Maintaining it

When a slice completes:

1. Change its status to *complete*.
2. Rewrite **Design** and **Implementation notes** to describe what was actually built,
   not what was planned. Record numbers that were observed, not predicted.
3. Add anything learned to **Implementation notes** — especially API surprises.
4. Expand the next slice to full detail.
5. Move any invariant worth enforcing into [CLAUDE.md](../CLAUDE.md).

---

## Ground rules

These apply to every slice. They are the same invariants as [CLAUDE.md](../CLAUDE.md),
restated with the reasoning.

### 1. Fixed timestep

Physics steps at exactly `TIMESTEP = 1/240 s`. The render loop accumulates elapsed real
time and steps a whole number of times:

```ts
accumulator += dt;
while (accumulator >= TIMESTEP && budget < 600) {
  sim.step();
  accumulator -= TIMESTEP;
  budget++;
}
```

Stepping by frame delta would make results depend on the display refresh rate and on how
busy the machine was, which destroys both reproducibility and comparability between
genomes. The `budget` cap stops a backgrounded tab from trying to catch up on ten seconds
of physics in one frame — a spiral that would freeze the page.

### 2. Seeded randomness only

No `Math.random()` anywhere in `packages/`. An `Rng` instance is passed explicitly to
anything that needs randomness. This is what makes a run replayable, a bug reproducible,
and the golden test possible.

### 3. `packages/evolution` is pure

No DOM, no `window`, no timers, no Rapier import, no I/O. It must run under Node. When it
needs to simulate, it takes an evaluator *function* as a parameter — it never imports the
simulator.

### 4. `packages/sim` owns Rapier and only Rapier

Builds a world from a morphology, steps it, returns numbers. It does not render, and it
does not know what a genome is.

### 5. Nothing browser-specific below `apps/web`

Workers, canvas, storage, UI — all live in the app.

### 6. The golden test is never weakened to make a change pass

It lives in `packages/evolution/__tests__/golden.test.ts` and pins twenty generations of
best fitness for seed 4417 against a synthetic evaluator. Changing SBX eta by one breaks it.
If it fails, either the change is a bug or the change is intentional — say which, in the
commit message, and regenerate the numbers in the same commit.

### 7. SI units everywhere

Metres, kilograms, seconds, radians. Pixels appear only under `apps/web/src/render/`.
World space is y-up; canvas is y-down; the flip lives in `render/camera.ts` alone.

### Definition of done, for every slice

- `npm test` passes.
- `npm run check` passes with no errors.
- `npm run sim` passes, including its determinism assertion.
- The app runs. No slice ends with a broken tree.
- One commit, whose message states the observable result (a time, a distance, a fitness).
- This document updated per [Maintaining it](#maintaining-it).

### On tests

Vitest was originally deferred to slice 2, on the reasoning that slice 1 had no logic worth
testing in isolation. That was wrong. Slice 1 shipped two silent bugs — a mass unit error
and joint limits that were never applied — both of which a five-line assertion would have
caught immediately, and neither of which the smoke test noticed because the robot fell over
either way.

The suite now runs in about 1.5 s, which is fast enough to run on every change. Its shape:

| File | Covers |
|---|---|
| `packages/evolution/__tests__/rng.test.ts` | Pinned golden vector, replay, distribution, bounds |
| `packages/evolution/__tests__/morphology.test.ts` | Mass, kinematic chain closure, limits, centre of mass |
| `packages/evolution/__tests__/controller.test.ts` | Clamping, periodicity, leg phasing, feedback term |
| `packages/evolution/__tests__/operators.test.ts` | Selection pressure, SBX invariants, mutation shape, codec |
| `packages/evolution/__tests__/golden.test.ts` | Pinned 20-generation run, elitism, convergence |
| `packages/evolution/__tests__/island.test.ts` | Frame-sliced evaluation, generator stage order, traced == untraced |
| `packages/evolution/__tests__/migration.test.ts` | Emigrant copying, immigrant placement, half-population cap |
| `packages/evolution/__tests__/spec.test.ts` | Chain closure for any spec, fixed topology, validation |
| `packages/sim/__tests__/world.test.ts` | Determinism, joint limits, motor authority, walking |

Two habits worth keeping:

- **Write the test that would have caught the bug**, not a test near it. The mass assertion
  is three lines and is the entire defence against a units error that made every torque
  figure in the project meaningless.
- **Verify a regression guard by reintroducing its bug.** Every guard here was checked
  that way — revert the fix, watch the test fail, restore it. A regression test that has
  never been seen to fail is a guess. The golden test was checked the same way, by nudging
  SBX eta from 15 to 16.
- **Pair a property test with its negative.** `never loses ground, because of elitism` is
  worth little on its own, because a search usually improves anyway. `loses ground when
  elitism is switched off` is what proves the first test measures elitism.

---

## Module map

```
packages/evolution/     pure TypeScript, runs under Node
  rng.ts                xoshiro128** — the only randomness in the project
  morphology.ts         what a robot is: segments, joints, dimensions
  controller.ts         (slice 1) genome -> joint targets over time
  operators.ts          (slice 2) selection, crossover, mutation
  island.ts             (slice 2) a population and its generation loop
  fitness.ts            (slice 2) trial result -> scalar score
  archive.ts            (slice 8) MAP-Elites grid

packages/sim/           owns Rapier, nothing else
  world.ts              morphology -> Rapier world; step; snapshot
  evaluate.ts           (slice 2) run one genome for a trial, return numbers

apps/web/               everything impure
  main.ts               entry, render loop, input
  render/camera.ts      the single world <-> screen transform
  render/draw.ts        canvas 2D renderer
  ui/                   (slice 1+) controls, charts, panels
  workers/              (slice 4) island workers

scripts/headless.ts     run the sim under Node with no browser
docs/                   this file and the design document
```

### Dependency direction

```
apps/web  ->  packages/sim  ->  packages/evolution
apps/web  ->  packages/evolution
```

Exactly one rule, and it is the load-bearing one: **`packages/evolution` imports nothing
from the other two.** That is what lets the whole search run under Node in a test.

`packages/sim` does import from `evolution` — the morphology types and the controller, so
that `stepControlled` can evaluate targets at the control rate. An earlier draft of this
document said "types only"; that was wrong, and slice 2 makes it more so, since `evaluate`
must decode a genome and run a controller. The real constraint is narrower: **sim never
imports the search** — no operators, no island, no archive. Physics knows what a robot is
and how to drive it; it does not know what a population is.

---

## Slice index

| # | Name | Sessions | Status |
|---|---|---|---|
| 0 | [It falls over](#slice-0--it-falls-over) | 1 | **complete** |
| 1 | [It walks, badly](#slice-1--it-walks-badly) | 1 | **complete** |
| 2 | [The GA finds a gait](#slice-2--the-ga-finds-a-gait) | 2 | **complete** |
| 3 | [You can watch it](#slice-3--you-can-watch-it) | 2 | **complete** |
| 4 | [Off the main thread](#slice-4--off-the-main-thread) | 2 | **complete** |
| 5 | [The stepper](#slice-5--the-stepper) | 3 | **complete** |
| 6 | [Guided first run](#slice-6--guided-first-run) | 2 | **complete** |
| 7 | [Body editor](#slice-7--body-editor) | 3 | **complete** |
| 8 | [Behaviour archive](#slice-8--behaviour-archive) | 2 | **complete** |
| 9 | [3D replay](#slice-9--3d-replay) | 3 | **complete** |
| 10 | [Gait analysis](#slice-10--gait-analysis) | 2 | **complete** |
| 11 | [Challenge track](#slice-11--challenge-track) | 3 | **complete** |
| 12 | [The server](#slice-12--the-server) | 3 | **complete** |
| 13 | [Community archive](#slice-13--community-archive) | 1 | **complete** |
| 14 | [Task suite](#slice-14--task-suite) | 3 | **complete** |
| 15 | [Help](#slice-15--help) | 1 | **complete** |

**Slices 0–3 are the spine.** They end with a genetic algorithm evolving a gait while you
watch a fitness curve climb. Everything after slice 3 is enrichment and can be reordered or
skipped. A version of Evolab that stops at slice 8 is a finished thing, not an abandoned
one.

---

## Slice 0 — It falls over

> **Status: complete.** Commit `264628d`.

### Goal

A jointed 2D sagittal biped ragdolls onto a floor under Rapier physics, rendered to a
canvas.

### Depends on

Nothing.

### Design

#### The morphology

Seven rigid segments, six revolute joints, a rest pose standing 0.92 m tall with the feet
flat on `y = 0`. All boxes; Rapier's `cuboid` takes **half**-extents.

| Segment | Half-width | Half-height | Centre (x, y) | Layer |
|---|---|---|---|---|
| `torso` | 0.09 | 0.18 | (0, 0.74) | body |
| `thighL` / `thighR` | 0.045 | 0.13 | (0, 0.43) | near / far |
| `shankL` / `shankR` | 0.035 | 0.125 | (0, 0.175) | near / far |
| `footL` / `footR` | 0.08 | 0.025 | (0.03, 0.025) | near / far |

Density 1000 kg/m³ throughout, giving ≈ 21 kg total.

| Joint | Parent → child | Parent anchor | Child anchor | Limits | Max torque |
|---|---|---|---|---|---|
| `hipL/R` | torso → thigh | (0, −0.18) | (0, 0.13) | −50°…90° | 120 N·m |
| `kneeL/R` | thigh → shank | (0, −0.13) | (0, 0.125) | −132°…8° | 88 N·m |
| `ankleL/R` | shank → foot | (0, −0.125) | (−0.03, 0.025) | −35°…25° | 60 N·m |

Anchors are in each body's **local** frame. The chain closes because each anchor pair
describes the same world point in the rest pose — e.g. the left hip is at world
(0, 0.56), which is `torso.y − 0.18` and `thigh.y + 0.13`.

`maxTorque` is carried but unused in slice 0; there is no controller yet.

Both legs sit at `x = 0`. In a strictly sagittal model that is correct — they occupy the
same plane. It is also why the renderer needs the offset described below.

#### The world

- Gravity `(0, −9.81)`.
- Ground: a fixed `cuboid(60, 0.5)` centred at `y = −0.5`, so its top surface is exactly
  `y = 0`. Friction 1.0.
- Segment colliders: friction 0.9, restitution 0.

#### Collision filtering

Robot parts must collide with the ground but never with each other, or the legs jam
against the torso. Rapier packs membership in the high 16 bits and the filter mask in the
low 16:

```ts
const GROUP_GROUND = 0b0001;
const GROUP_ROBOT  = 0b0010;
const GROUND_GROUPS = (GROUP_GROUND << 16) | 0xffff;   // ground collides with everything
const ROBOT_GROUPS  = (GROUP_ROBOT  << 16) | GROUP_GROUND; // robot collides with ground only
```

#### Making it fall

`spawnFalling(morph, rng)` rotates the entire rest pose about the origin by a seeded angle
in `[−0.09, 0.09]` rad, and sets each body's initial rotation to match. Rotating positions
*and* orientations together keeps the joint constraints satisfied at `t = 0`, so there is
no start-up jolt.

A run is flagged `fallen` when the torso centre drops below 55 % of its rest height
(0.55 × 0.74 ≈ 0.407 m). This threshold is reused as the early-termination test in slice 2.

#### Rendering

`fitCamera(w, h)` frames ~1.8 m of height and ~4 m of width:

```
scale = min(h / 1.8, w / 4)              px per metre
ax    = w * 0.5                          canvas x of world x = 0
ay    = h - max(48, h * 0.14)            canvas y of world y = 0

screenX = ax + (worldX - cx) * scale
screenY = ay - (worldY - cy) * scale     the y flip, in one place only
```

Bodies draw back to front: `far`, then `body`, then `near`. Canvas rotation is `-angle`,
because a positive world rotation is anticlockwise but canvas y points down.

### Files

```
package.json  tsconfig.base.json  tsconfig.json  .gitignore  CLAUDE.md
packages/evolution/{package.json, src/{index,rng,morphology}.ts}
packages/sim/{package.json, src/{index,world}.ts}
apps/web/{package.json, vite.config.ts, index.html, src/main.ts, src/render/{camera,draw}.ts}
scripts/headless.ts
docs/technical-design.html
```

### Implementation notes

**Rapier needs async init.** `await RAPIER.init()` exactly once per process before any
other call. `initPhysics()` guards this with a module-level flag. Constructing a `Sim`
before init throws with a clear message rather than a WASM fault.

**Rapier allocates in WASM memory.** `World.free()` is not optional — `Sim.dispose()` must
be called before dropping a sim, or a long session leaks. This matters enormously from
slice 2, where thousands of sims are created.

**Node strips types, it does not compile them.** `npm run sim` uses
`node --experimental-strip-types`, which erases type annotations and rejects any syntax
that *emits* code. In practice: no parameter properties (`constructor(private x: number)`),
no `enum`, no namespaces, no decorators. This was hit immediately on `Rng`. Every file must
stay strip-compatible; that is what keeps tests and scripts free of a build step.

**`allowImportingTsExtensions`** must be on, because imports are written with explicit
`.ts` extensions so that Node, Vite and `tsc` all resolve them identically.

**Packages are consumed as source.** Vite aliases `@evolab/evolution` and `@evolab/sim` to
their `src/index.ts`. There is no package build step and there should not be one — it buys
nothing and costs a watch process.

**The renderer's one lie.** `FAR_LEG_RENDER_OFFSET = 0.055 m` nudges the far leg sideways
when drawing, because otherwise the two legs overlap exactly at rest and the biped looks
like a pogo stick. Physics, fitness and trajectories all use true positions. Zero it when
checking a screen position against a world coordinate. `JointAnchor.layer` exists purely to
let joint markers follow the same offset.

### Done when

- [x] `npm run dev` shows a biped that stands, topples and settles.
- [x] `npm run sim` prints the fall and reports `replay match yes`.
- [x] `npm run check` is clean.
- [x] `?seed=` and `?paused=1` work; `R` / `Space` / `.` work.

**Observed:** seed 4417 falls after 0.39 s and settles with the torso at 0.1951 m; a replay
of the same seed matches to within 1e-12. 720 steps for 3 s of simulated time.

### Deliberately not in this slice

No controller, no motors, no genetic algorithm, no UI beyond the HUD, no React, no workers,
no 3D. Slice 0 proves the physics and the render loop and nothing else.

---

## Slice 1 — It walks, badly

> **Status: complete.** One session, plus a long diagnostic detour recorded in
> [the motor stiffness trap](#the-motor-stiffness-trap) — worth reading before touching
> the physics.

### Goal

Drive the joints with a hand-tuned periodic controller and a panel of sliders, so you
discover first-hand how hard gait tuning is. It should lurch, and it should be frustrating.
That frustration is the setup for slice 2.

### Depends on

Slice 0.

### Design

#### The controller

A per-joint Fourier series over gait phase, truncated to one harmonic for now. This is the
*parametric* encoding from §3 of the design document, and it stays the default controller
for the whole project because every parameter maps to a visible feature of a curve.

For joint *j* at time *t*:

```
phase   = 2π · f · t + φ_j
target_j(t) = c_j + A_j · sin(phase)
```

with a per-side phase offset so the legs alternate: right-side joints add π to `φ`.

| Parameter | Meaning | Range | Slider default |
|---|---|---|---|
| `f` | gait frequency, global | 0.5 … 3.0 Hz | 1.4 |
| `A_j` | amplitude, per joint | 0 … 0.8 rad | hip 0.40, knee 0.50, ankle 0.20 |
| `φ_j` | phase offset, per joint | 0 … 2π | hip 0, knee 2.2, ankle 3.6 |
| `c_j` | centre angle, per joint | joint limits | hip 0.10, knee −0.35, ankle 0 |

Six joints but left and right are mirrored, so there are **three** independent joint
triples plus the global frequency: `3 × 3 + 1 = 10` numbers. Mirroring is a deliberate
simplification — asymmetry is something evolution should discover, not something the
slider panel should offer.

Targets are clamped to the joint's limits before being applied.

#### Driving the joints

Rapier revolute joints have a built-in position motor. Per control tick, for each joint:

```ts
joint.configureMotorPosition(target, stiffness, damping);
```

Start with `stiffness = 12`, `damping = 1.2`, tuned per joint scale if the response is
mushy or unstable. The motor is a PD controller in disguise: stiffness is P, damping is D.

> **Verify at implementation time.** The exact accessor for a revolute impulse joint in
> `@dimforge/rapier2d-compat` 0.14 needs checking against the installed typings —
> `world.createImpulseJoint()` returns a base `ImpulseJoint`, and the motor methods live on
> the revolute specialisation. Keep the returned handles in `Sim` when the joints are
> created rather than looking them up later. If the motor API proves awkward, the fallback
> is applying torques directly from a PD law:
> `τ = clamp(k_p·(target − θ) − k_d·θ̇, −maxTorque, +maxTorque)`, using
> `body.applyTorqueImpulse(τ · dt, true)` on the child and its negation on the parent.

#### Control rate

The controller runs at **60 Hz**, not at the physics rate — every 4th step at 1/240 s.
Real actuators do not update at 240 Hz, and decoupling the two means the physics rate can
change later without changing gait behaviour.

```ts
const CONTROL_EVERY = 4;
if (stepCount % CONTROL_EVERY === 0) applyControl(t);
sim.step();
```

#### API shape

In `packages/evolution/controller.ts` — pure, no Rapier:

```ts
export interface GaitParams {
  frequency: number;
  joints: Record<'hip' | 'knee' | 'ankle', { amplitude: number; phase: number; centre: number }>;
}

/** Target angle for every joint at time t, keyed by joint id. */
export function gaitTargets(params: GaitParams, t: number): Map<string, number>;

export function defaultGait(): GaitParams;
```

In `packages/sim` — `Sim` gains:

```ts
setJointTargets(targets: Map<string, number>): void;
```

The sim applies targets to motors; it never computes them. That boundary is what lets
slice 2 swap the controller without touching physics.

### Files

- `packages/evolution/src/controller.ts` — new
- `packages/evolution/src/index.ts` — export the above
- `packages/sim/src/world.ts` — keep joint handles, add `setJointTargets`
- `apps/web/src/ui/sliders.ts` — new; a plain DOM slider panel, no framework
- `apps/web/src/main.ts` — wire the control tick into the loop
- `scripts/headless.ts` — drive the default gait for 8 s, print distance travelled

### Implementation notes

- **No React yet.** A slider panel is `<input type="range">` elements and an event
  listener. React arrives when there are panels worth componentising, around slice 6.
- **Show the numbers.** Each slider displays its value to 2 dp. Tuning blind is miserable.
- **Add a distance readout to the HUD** — torso `x` displacement from spawn. It becomes
  the primary fitness term in slice 2, so seeing it now builds the intuition.
- **Persist slider state in the URL** (`?gait=...` as compact JSON, or individual params).
  You will want to show someone a lurch you found, and you will want it back after a reload.
- **Expect it to be bad.** A hand-tuned open-loop gait on a 6-DoF biped will travel maybe
  1–3 m before falling. That is the correct outcome and the whole point of the slice.

### Done when

- [x] Sliders visibly change the motion, in real time, without a respawn.
- [x] The HUD shows distance travelled and gait phase.
- [x] `npm run sim` drives the default gait and prints distance and time-to-fall.
- [x] Same seed plus same parameters still replays identically.
- [~] *Some setting exists that moves the biped at least 1 m before it falls* — best found
  is **0.95 m**, from a 120-generation population search over the same parameter space.
  Not met, and not reachable. See below.

**Observed:** the default gait travels −0.19 m and falls at 0.62 s. The best known gait
travels 0.95 m and falls at 1.30 s. Both replay exactly.

### Two bugs found in slice 0

Both were silent, and both invalidated numbers already written down.

**Density is mass per unit area, not volume.** Rapier's 2D world computes
`mass = density × area` — the simulation is a slice through a body of unit depth. Slice 0
used `density: 1000`, which built a **163 kg** biped, not the ≈21 kg claimed. Fixed by
introducing `DENSITY = 130 kg/m²` (1000 kg/m³ × 0.13 m of limb depth), giving 21.1 kg.
Motors hid the error because they are acceleration-based and therefore mass-independent,
but every `maxTorque` figure was meaningless.

**Joint limits set on `JointData` are silently ignored.** Setting
`params.limitsEnabled = true; params.limits = [min, max]` before
`world.createImpulseJoint()` has no effect for 2D revolute joints in Rapier 0.14 — the
joint comes back with `limitsEnabled() === false` and bounds of ±3.4e38. Limits must be
applied to the created joint with `handle.setLimits(min, max)`. Slice 0 did it the first
way, so the biped had no joint limits at all and its knees bent both directions.

### The motor stiffness trap

The biped originally could not stay upright for more than about a second whatever the gait
parameters, and the first diagnosis of that was **wrong** in a way worth recording, because
the wrong answer was plausible and well-evidenced.

The symptom looked exactly like the textbook result that an inverted pendulum cannot be
balanced open-loop: relative joint angles carry no world-frame reference, so no combination
of them can know the robot is tipping. That reasoning was sound and the conclusion was
false. The cause was mundane: **the motor gains were about two hundred times too small.**

A position motor is a spring, not a rigid link. Under a sustained gravitational moment it
deflects, the deflection moves the centre of mass further off the support, and that
increases the moment. That much was right. What was missed is that the runaway simply stops
happening once the spring is stiff enough — it is a threshold, not an asymptote.

**The test that settled it**, holding the rest pose against a 0.03 rad tilt for 12 s:

| Joint treatment | Result |
|---|---|
| Every revolute replaced by a fixed joint | stands 12 s |
| Revolute with limits clamped to (0, 0) | stands 12 s |
| Motor, `k` = 2 000 | falls at 1.10 s |
| Motor, `k` = 20 000 | falls at 2.13 s |
| **Motor, `k` = 100 000** | **stands 12 s, torso angle 0.000** |

The first two rows prove the articulation and the contacts are sound. The last row proves
the motors can hold it. Everything between was an actuator strength problem wearing a
control theory costume.

`MOTOR_STIFFNESS` is now **80 000** with damping at `k/10`, the lowest value that held the
pose at every initial tilt tried. With it:

| Measurement | Before | After |
|---|---|---|
| Standing, no oscillation | falls at ≈1.1 s | stands indefinitely |
| Default gait | 0.00 m, falls at 0.60 s | −1.53 m, falls at 2.00 s |
| Best gait found by a 100-generation search | 0.73 m, falls at 1.9 s | **12.6 m, never falls** |

**Lessons worth keeping.** When a physical system misbehaves, bisect the *mechanism* before
theorising about the *class* of solution: welding the joints would have taken five minutes
and pointed straight at the actuators. And an explanation that predicts "no parameter value
will work" should always be tested by trying an absurd parameter value, because that test
is cheap and the conclusion is expensive.

### The balance gene

Slice 1 also added `balanceGain`, a single parameter coupling torso pitch to hip target:

```
correction = balanceGain · (pitch + PITCH_LEAD · pitchRate)
hipTarget += correction
```

where pitch is forward-positive and `PITCH_LEAD = 0.12 s` is a fixed lead term — a
first-order prediction of where the torso will be, so the response damps instead of
oscillating. It is the one part of the controller that is not a function of time.

**It does not currently earn its place**, and the honest record is that it was added to
solve a problem that turned out to be something else. With the motor gains corrected, a
100-generation search with the gene disabled reached 18.8 m and with it enabled reached
16.5 m — a difference well inside run-to-run noise, and evolution drove the gain to 0.0 in
the earlier under-powered runs.

It is kept because it costs one parameter, the range spans zero so evolution can switch it
off for free, and it is the mechanism the task suite will need on rough terrain and under
pushes (§6 of the design document) where a purely periodic controller genuinely cannot
react. Setting the slider to zero and watching what changes — nothing, on flat ground — is
also a decent lesson in itself.

Note this does mean the controller is no longer strictly open loop, a small amendment to §3
of the design document.

### Deliberately not in this slice

No genetic algorithm, no fitness function, no optimisation, no asymmetry between legs. The
controller is strictly a function of time — which turns out to be exactly the problem.

---

## Slice 2 — The GA finds a gait

> **Status: complete.** Two sessions.

### Goal

A genetic algorithm searches gait parameters and finds something that walks further than
you managed by hand. Console output only — the visualisation is slice 3.

### Depends on

Slices 0 and 1.

### Design

#### Genome representation

A `Float32Array` of length *n*, every gene in `[0, 1]`. Decoding maps each gene through a
per-parameter range. Keeping the genome in unit space means every operator is
encoding-agnostic — mutation and crossover never need to know what a gene means.

For the mirrored parametric controller of slice 1: `n = 11`.
See [Appendix B](#appendix-b--genome-layouts) for the exact layout.

```ts
export type Genome = Float32Array;
export function decodeGait(genome: Genome): GaitParams;
```

#### Evaluation

`packages/sim/src/evaluate.ts`:

```ts
export interface TrialResult {
  distance: number;        // torso x displacement, metres
  uprightTime: number;     // seconds before falling (or full trial length)
  energy: number;          // Σ |τ · Δθ| over the trial, joules
  fell: boolean;
  duration: number;
}

export function evaluate(
  morph: Morphology,
  genome: Genome,
  opts: { seed: number; seconds: number },
): TrialResult;
```

Trial length **4 s** in slice 2 (2D, guided-scale runs — see §4 of the design document).
Early-terminate the moment `fallen` becomes true; this saves roughly 40 % of the
simulation budget because most early genomes fall almost immediately.

`evaluate` must call `sim.dispose()` in a `finally`. Thousands of these run per generation.

#### Fitness

Keep it defensive from the first line. Naïve distance-only fitness reliably evolves a robot
that dives forward and lands on its face — see §3 and §7 of the design document, where this
is eventually staged as a deliberate lesson. For now, the defensive terms are on:

```
fitness = 1.0 · distance
        + 0.5 · (uprightTime / duration)
        − 0.3 · max(0, energy / 400 − 1)
```

Negative fitness is clamped to 0. Every term is logged separately so a collapse can be
attributed to a cause.

#### Operators

All in `packages/evolution/src/operators.ts`, all taking an `Rng` explicitly.

**Tournament selection**, size 3: draw 3 individuals uniformly at random, return the
fittest. Repeat to fill the parent pool.

**SBX crossover** (simulated binary, η = 15, applied per gene with probability 0.9). For
parents `p1`, `p2` and `u ~ U(0,1)`:

```
β  = (2u)^(1/(η+1))                    if u ≤ 0.5
β  = (1 / (2(1−u)))^(1/(η+1))          otherwise

c1 = 0.5[(1+β)·p1 + (1−β)·p2]
c2 = 0.5[(1−β)·p1 + (1+β)·p2]
```

Clamp children to `[0, 1]`. SBX blends rather than splices, which suits continuous control
parameters far better than single-point crossover.

**Polynomial mutation** (η = 20, per-gene rate `1/n`):

```
δ = (2u)^(1/(η+1)) − 1                 if u < 0.5
δ = 1 − (2(1−u))^(1/(η+1))             otherwise

x' = clamp(x + δ, 0, 1)
```

**Elitism:** the 2 fittest individuals pass to the next generation unchanged. This is not
optional — without it the best gait can be lost to an unlucky draw, and the fitness curve
develops dips that look like bugs.

#### The island

```ts
export interface Individual { genes: Genome; fitness: number; result: TrialResult | null; }

export interface Island {
  readonly id: number;
  readonly rng: Rng;
  generation: number;
  population: Individual[];
}

export function createIsland(size: number, genomeLength: number, seed: number): Island;

export function stepGeneration(
  island: Island,
  evaluateFn: (g: Genome, seed: number) => TrialResult,
): GenerationSummary;
```

Note that `stepGeneration` takes the evaluator as a **parameter**. That is ground rule 3 in
action: `packages/evolution` never imports `packages/sim`, so the whole GA is testable with
a fake evaluator that returns arithmetic.

```ts
export interface GenerationSummary {
  generation: number;
  best: number;
  mean: number;
  worst: number;
  diversity: number;    // mean pairwise Euclidean distance in genome space
  bestGenome: Genome;
}
```

**Defaults:** population 24, generations 30, tournament 3, elites 2, crossover 0.9,
mutation `1/n`, one evaluation seed per individual.

#### The golden test

The highest-value test in the project. Create it in this slice, and never weaken it.

```ts
// packages/evolution/__tests__/golden.test.ts
test('seed 4417 evolves a known fitness sequence', () => {
  const island = createIsland(24, 10, 4417);
  const seq: number[] = [];
  for (let g = 0; g < 20; g++) seq.push(stepGeneration(island, fakeEvaluate).best);
  expect(seq).toEqual(GOLDEN);   // 20 exact numbers, committed
});
```

Use a **deterministic synthetic evaluator** here — a closed-form function of the genome,
not the physics. That keeps the test at millisecond speed and isolates GA regressions from
physics changes. A second, slower test can pin one real physics trial.

If this test fails: either the change is a bug, or the change is deliberate and the golden
values are regenerated *in the same commit*, with the reason in the message.

### Files

- `packages/evolution/src/{operators,island,fitness}.ts` — new
- `packages/evolution/src/controller.ts` — add `decodeGait`
- `packages/evolution/__tests__/golden.test.ts` — new
- `packages/sim/src/evaluate.ts` — new
- `scripts/evolve.ts` — new; run a search from the CLI and print progress
- `package.json` — add `vitest`, add `"test": "vitest run"`

### Implementation notes

- **Vitest is already installed and configured** — it arrived in slice 1, one slice later
  than it should have. Add the golden test to the existing suite; no setup needed.
- **Dispose every sim.** The single most likely cause of a mysteriously slow or crashing
  run is leaked Rapier worlds.
- **Log per-generation to the console** as a fixed-width table: generation, best, mean,
  diversity. You will read hundreds of these.
- **Watch diversity, not just fitness.** Collapsing diversity with flat fitness means
  premature convergence — the population has agreed on a mediocre answer. It is also the
  concept that slice 11 teaches, so getting the metric right now pays twice.
- **Expect roughly 300 ms per generation** for 24 individuals × 4 s trials on one core.
  An earlier draft said 40 ms, which was §4 of the design document quoted wrongly — that
  figure already divides by seven workers, and workers do not arrive until slice 4. Per
  trial the cost is ~12 µs per step, comfortably under the 30 µs the design document
  budgets. If it is much slower than that, suspect undisposed worlds.

### Done when

- [x] `npm run evolve` finds a gait travelling further than anything from slice 1.
- [x] The golden test passes and is committed with its expected values.
- [x] Diversity is reported and visibly falls over a run.
- [x] Re-running with the same seed produces byte-identical output.
- [x] Elitism demonstrably works: best fitness is monotonically non-decreasing.

**Observed**, 120 generations of 24 individuals on 8 s trials, seed 4417:

| | |
|---|---|
| Champion | 17.74 m, never fell, fitness 18.24 |
| Slice 1 reference | 12.59 m |
| Generalisation | 5/5 unseen tilts upright, 17.37–17.76 m, median 17.57 m |
| Diversity | 1.38 → 0.06 |
| Throughput | 602 ms/generation, 2642 trials in 72 s |
| Monotonic | yes, elitism holds |

A 30-generation 4 s run — the default — takes 9 s and reaches 4.8 m.

### One flaw found, and it mattered

The first working version set `trialSeed = island.generation`, so the initial tilt changed
every generation. That looks harmless and is not, because **elites carry their fitness
forward without being re-evaluated**. A genome that happened to draw a favourable tilt kept
that score for ever, and the reported champion was part luck.

It surfaced the only way it could have: the champion scored 17.1 m in the CLI and fell over
at 3.5 s when the same eleven numbers were pasted into the slice-1 UI, which uses a
different tilt. Two runs of the same gait disagreeing is a much louder signal than a fitness
curve that merely looks optimistic.

The fix is `IslandConfig.trialSeed`, fixed for the whole run. Every individual then faces
identical conditions, elite fitness stays valid, and best fitness is genuinely monotonic.

The cost is that a champion is tuned to one perturbation. Rather than hide that,
`npm run evolve` now re-tests the champion on five unseen tilts and prints the spread — the
same argument §6 of the design document makes for five-seed medians in the task suite, only
arrived at by being bitten. With the fix the champion generalises cleanly; without it, it
did not.

**Rule worth keeping:** if any individual's score survives across generations, the
conditions it was scored under must not change. Either hold them fixed or re-evaluate
everything, every generation. Do not mix.

### Deliberately not in this slice

No charts, no UI, no workers, no MAP-Elites, no multi-objective, no CPG. Console output
only. Resist making it pretty — that is the next slice, and it is much more satisfying when
the algorithm underneath already works.

---

## Slice 3 — You can watch it

> **Status: complete.** Two sessions. **The payoff.**

### Goal

A fitness chart climbing in real time next to a live replay of the current champion. The
moment the project becomes interesting to look at.

### Depends on

Slices 0–2.

### Design

#### Layout

Three regions, matching the eventual chassis in §8 of the design document so nothing has to
be relearned later:

```
┌──────────────────────────────────────────────┐
│ toolbar: run / pause / reset · gen 18 / 30   │
├───────────────┬──────────────────────────────┤
│ stage         │ fitness chart                │
│ (champion     ├──────────────────────────────┤
│  replay)      │ run stats                    │
└───────────────┴──────────────────────────────┘
```

#### Driving evolution from the UI thread

Evolution still runs on the main thread in this slice — workers are slice 4.

This slice was planned around **one generation per animation frame**, on the assumption of
~40 ms per generation. That assumption was already known to be wrong by the end of slice 2:
a generation of 24 four-second trials costs roughly **300 ms** on one core, about twenty
frames. Running one per frame would have dropped the page to 3 fps — the exact stutter the
plan's own implementation note warned about.

The fix keeps slice 3's scope rather than pulling workers forward. Evaluation is split from
the rest of the generation and **sliced across frames** under a time budget:

```ts
export function evaluatePending(island, evaluate, shouldContinue): number;
export function completeGeneration(island, evaluations): GenerationSummary;
export function pendingCount(island): number;

// stepGeneration is now just the two together, for the CLI and the tests.
```

The frame loop spends `EVAL_BUDGET_MS` (8 ms) on evaluation, then yields. A generation
therefore spans several frames and completes only when `pendingCount` reaches zero —
ranking a half-scored population would leave unevaluated individuals sitting at fitness 0
and being selected against unfairly.

Two details that matter:

- **The budget is a predicate, not a clock read.** `evaluatePending` takes
  `shouldContinue: () => boolean` so `packages/evolution` keeps its no-timers rule. The
  caller owns the clock.
- **It always runs at least one trial.** A budget that can starve would leave the
  generation pending for ever and the page would sit at generation 0 looking broken.

Because nothing here consumes randomness — the evaluator is deterministic in
`(genome, trialSeed)` and all the RNG draws happen in `completeGeneration` — the sliced
path and the whole-generation path produce identical runs. That is asserted directly in
`island.test.ts`, drip-feeding one individual per call and comparing every field of every
summary against `stepGeneration`. Without that test, a run watched in the UI and a run
reproduced by the CLI could quietly diverge, and the golden test would only be guarding one
of them.

#### Champion replay

A separate long-lived `Sim`, independent of evaluation, stepping at real-time rate and
looping. When a new champion appears, dispose and respawn it with the new genome. The
replay is for looking at; it never contributes to fitness.

#### The chart

Hand-rolled canvas, not a charting library. It draws three series over generation index:
best (amber, 2 px), mean (cyan, 1.4 px), and an inter-quartile band (cyan at 14 % alpha).

Keep it in `render/chart.ts` with a signature that takes a plain array of summaries and a
rect. uPlot arrives only if hand-rolled becomes a burden, which for a few hundred points
it will not.

#### State

A single plain object, no state library:

```ts
interface RunState {
  island: Island;
  history: GenerationSummary[];
  champion: { genes: Genome; fitness: number } | null;
  running: boolean;
  target: number;
}
```

Zustand arrives when there are multiple panels sharing state, around slice 6.

### Files

- `apps/web/src/run/state.ts`, `apps/web/src/run/loop.ts` — new
- `apps/web/src/render/chart.ts` — new
- `apps/web/src/main.ts` — restructure around the run loop
- `apps/web/index.html` — the three-region layout

### Implementation notes

- **Keep the slice-1 slider panel**, switchable between *manual* and *evolved*. Being able
  to flip between your hand-tuned gait and the evolved one, on the same screen, is the most
  persuasive thing in the app.
- **Do not block the frame.** If one generation ever exceeds ~16 ms the page stutters; that
  is the signal to bring slice 4 forward.
- **Show the generation counter and elapsed time.** Honest progress beats a spinner.

### Done when

- [x] Pressing *run* fills a fitness chart live, generation by generation.
- [x] The champion replay updates when the champion improves, and the first champion
  switches the stage to it automatically so the payoff needs no click.
- [x] Manual and evolved gaits can be compared side by side, with *Copy champion to
  sliders* to hand one back for poking at.
- [x] The page stays responsive: evaluation never occupies more than one trial beyond its
  8 ms slice.

**Observed** at 24 individuals and 4 s trials: 150–230 trials/s and 6–10 generations/s,
measured over evaluation time only. Early generations run fastest because most genomes fall
almost immediately and early termination cuts their trials short.

### A note on tab visibility

The search is driven by `requestAnimationFrame`, so it stops when the tab is hidden — the
browser throttles rAF to roughly 1 Hz in the background. This is worth knowing while
testing: a preview pane that reports `document.visibilityState === 'hidden'` will make a
perfectly healthy search look broken.

It is also a real limitation for a user who starts a long run and switches tabs. Slice 4
fixes it as a side effect: workers are not tied to the frame clock.

### Deliberately not in this slice

No workers, no archive, no islands plural, no 3D, no persistence. One population, one
thread, one chart.

---

## Slice 4 — Off the main thread

> **Status: complete.** Two sessions.

### Goal

Evaluation moves into Web Workers, one island per worker, so throughput scales with cores
and the UI never stutters.

### Depends on

Slices 0–3.

### Design

#### Topology

`N = min(hardwareConcurrency − 1, 8)` workers, each owning one island. Islands evolve
independently and exchange 2 elites with ring neighbours every 5 generations. No
per-generation synchronisation barrier — a worker never waits for the slowest trial in
another island.

#### Protocol

Raw `postMessage` with a discriminated union. No Comlink: the protocol is small enough that
a dependency would cost more than it saves.

```ts
// main -> worker
type ToWorker =
  | { type: 'init'; islandId: number; morphology: Morphology; seed: number; config: GaConfig }
  | { type: 'run'; generations: number }
  | { type: 'pause' }
  | { type: 'immigrate'; genomes: Float32Array }   // transferable
  ;

// worker -> main
type FromWorker =
  | { type: 'generation'; islandId: number; summary: GenerationSummary }
  | { type: 'emigrants'; islandId: number; genomes: Float32Array }
  | { type: 'error'; islandId: number; message: string }
  ;
```

Genome payloads are `Float32Array` and are **transferred**, not copied:

```ts
worker.postMessage(msg, [genomes.buffer]);
```

Note that a transferred buffer is detached on the sender's side. Copy before sending if the
sender still needs it — this is a classic source of confusing empty-array bugs.

#### Migration

The main thread is the postman, not the scheduler. When a worker reports emigrants, the
main thread forwards them to `(islandId + 1) % N`. Migration is asynchronous and a lost or
late migrant degrades search quality slightly rather than corrupting anything — which is
exactly why the island model was chosen (§2 of the design document).

#### Worker module

```ts
// apps/web/src/workers/island.worker.ts
import { createIsland, stepGeneration } from '@evolab/evolution';
import { initPhysics, makeEvaluator } from '@evolab/sim';
```

Vite handles worker bundling via `new Worker(new URL('./island.worker.ts', import.meta.url), { type: 'module' })`.
Each worker calls `await initPhysics()` before its first evaluation — Rapier's WASM is
per-worker, since WASM memory is not shared.

### Files

- `apps/web/src/workers/island.worker.ts`, `apps/web/src/workers/pool.ts` — new
- `apps/web/src/run/loop.ts` — drive the pool instead of a local island
- `packages/sim/src/evaluate.ts` — factor out `makeEvaluator(morph, opts)`

### Implementation notes

- **Per-worker WASM init is the main start-up cost.** Roughly 40 ms each; initialise all
  workers in parallel at app start, not on first run.
- **Aggregate the chart across islands.** Best-of-all-islands is the amber line; mean of
  means is the cyan one. Per-island sparklines arrive with the full Evolution Lab.
- **Cap workers on touch devices** at 4, per §10 of the design document.
- **Determinism is now per island.** Each island has its own seeded stream, so a run is
  reproducible given the same island count. Changing `N` changes results — record `N` in
  the run config, and keep the golden test single-island.

### Done when

- [x] Throughput scales roughly linearly with worker count.
- [x] The UI never does physics at all, so the frame budget stops constraining the search.
- [x] Migration is observable: the islands panel flags an island whose best jumped within a
  generation or two of an arrival.
- [~] *Same seed and same worker count reproduces exactly* — **not achievable, and the plan
  contradicted itself here.** See below.

**Observed**, 24 individuals and 4 s trials on this machine:

| Workers | Trials/s | Parallel speedup | 20 generations |
|---|---|---|---|
| 1 | 88 | 1.0× | 5.0 s |
| 4 | 329 | 3.7× | — |

3.74× throughput on four workers. A full 40-generation run finished in 10.7 s reaching
fitness 6.88 and a 6.38 m gait.

### Islands multiply population, not generation rate

Worth stating plainly, because the numbers above look disappointing until you see it:
generations per second barely moved (4.0 → 3.7). Each island still steps at single-thread
speed. What four workers buy is **four populations searching at once**, so a run reaches
generation 40 in about the same wall-clock time as before but has done four times the
search and shared the results through migration.

If what you want is one island reaching generation 400 faster, workers do not do that.
Nothing does — a generation is inherently sequential.

### Reproducibility: the plan contradicted itself

The design said, three paragraphs apart, both that "migration is asynchronous and a lost or
late migrant degrades search quality slightly rather than corrupting anything" and that the
slice is done when "same seed and same worker count reproduces exactly".

Those cannot both hold. A migrant that lands before generation 7 rather than after it
changes every draw from that point on, and arrival timing depends on OS scheduling. You can
have barrier-free asynchrony or bit-exact reproducibility, not both.

**Resolved in favour of asynchrony**, because that is the property the island model was
chosen for (§2 of the design document) and a barrier every five generations would make the
whole ring wait on its slowest island. The consequences, stated honestly:

- **One worker is bit-reproducible.** The CLI, `npm run sim` and the golden test all run
  single-island, so every guarantee the project has actually made still holds.
- **Several workers are statistically reproducible, not bit-reproducible.** Same seed, same
  worker count, same shape of result — not the same numbers.

If exact multi-island replay is ever wanted, the cheapest route is to have the pool collect
and redistribute migrants at a fixed generation boundary, making the ring synchronous once
every five generations. That is a real option, not a hard problem; it just costs the thing
this slice was for.

### Deliberately not in this slice

No cloud, no server, no SharedArrayBuffer, no cross-tab anything. The hybrid ring described
in the design document is cut — see §2 of that document for why.

---

## Slice 5 — The stepper

> **Status: complete.** Three sessions.

### Goal

Pause the algorithm between operators and show each one acting on real genomes: population,
evaluate, select, crossover, mutate, replace. The teaching screen — Fig 9.4 of the design
document.

### Depends on

Slices 0–3. Works against a single island, so it does not need slice 4.

### Design

#### The key structural idea

Rewrite `stepGeneration` as a **generator** that yields at each operator boundary. The
stepper then comes almost free, and — crucially — it drives the same code path as a normal
run rather than a parallel implementation of it.

```ts
export type Stage =
  | { stage: 'population'; individuals: Individual[] }
  | { stage: 'evaluate'; results: TrialResult[] }
  | { stage: 'select'; tournaments: { drawn: number[]; winner: number }[] }
  | { stage: 'crossover'; pairs: { a: Genome; b: Genome; child: Genome; cut: [number, number] }[] }
  | { stage: 'mutate'; mutations: { index: number; gene: number; from: number; to: number }[] }
  | { stage: 'replace'; summary: GenerationSummary };

export function* generation(island: Island, evaluateFn: Evaluator): Generator<Stage, GenerationSummary>;
```

Normal running becomes `for (const _ of generation(island, ev)) {}` — drain it. The stepper
advances it one `next()` at a time. One implementation, two speeds.

#### Rendering genomes

Gene strips: a genome drawn as *n* coloured cells. Provenance colours during crossover
(parent A violet, parent B cyan), mutated cells amber with a ring. Canvas, not DOM nodes.

### Files

- `packages/evolution/src/island.ts` — restructured around the generator
- `packages/evolution/src/operators.ts` — optional trace sinks
- `apps/web/src/ui/stepper.ts`, `apps/web/src/ui/explanations.ts` — new
- `apps/web/src/render/genes.ts` — new

### The refactor, and the constraint that shaped it

Converting to a generator is behaviour-preserving or it is nothing. The golden test passed
untouched before and after, and `npm run evolve` returns the same champion fitness of
6.4598 it did in slice 4 — which is the real proof, since it exercises the physics path too.

The constraint that dictated the design is the **order of random draws**. Per breeding pair
the algorithm does: two tournaments, one crossover, then a mutation for each child actually
kept. The obvious way to give the UI three tidy phases is to do all the tournaments, then
all the crossovers, then all the mutations — and that reorders every draw from the second
pair onward, silently invalidating every stored gait.

So the generator yields **per pair**, cycling `select → crossover → mutate`, rather than per
phase. That preserves the order exactly and is the better teaching object anyway: you follow
one child from selection to birth instead of watching an operator applied twenty-two times.

One subtlety worth keeping: when the population fills on the first child, the second is
discarded *before* being mutated and consumes no randomness. Preserving that is part of
preserving the order.

### Tracing must not perturb anything

Operators take optional sinks — `tournament(..., drawn?)`, `sbx(..., blended?)`,
`mutate(..., changes?)` — that record what happened without consuming randomness. Tracing
is off by default, so the worker path allocates nothing for a screen nobody is looking at.

`island.test.ts` asserts a traced run and an untraced run produce identical populations, ten
generations deep. Without that, the algorithm on the teaching screen could drift from the
one that actually runs, and the screen would become a lie in exactly the way that is hardest
to notice.

### Structure

```
generation(island, evaluate, { trace })   the single implementation, a generator
  -> stepGeneration(island, evaluate)     drain it; workers, CLI, tests
  -> completeGeneration(island, n)        shares breed() with it; incremental callers
```

`breed` is shared, so the stepper and the fast path cannot diverge by construction rather
than by discipline.

### What SBX actually does

The plan's `Stage` type asked for `crossover: { cut: [number, number] }`. That assumes
two-point crossover. SBX interpolates gene by gene and has no cut point, so the trace
reports per-gene provenance instead: **blended**, or **copied straight through** from one
parent. Drawing a cut would have meant drawing something the algorithm does not do.

That turns out to be the more interesting picture. In the screen shown, ten of eleven genes
were blended and one was copied — and the copied gene appears violet in child 1 and cyan in
child 2, at the same position, which makes the two-children-from-two-parents structure
visible at a glance.

### Done when

- [x] Stepping through one generation shows every operator acting on real values.
- [x] The golden test is untouched and passes.
- [x] Running normally produces identical results — `npm run evolve` still returns 6.4598.

**Observed.** The teaching lands harder than expected in two places, both accidents of a
real run rather than anything designed:

- The **evaluate** stage on generation 0 shows one genome at 0.254 and every other at
  0.000. "Most early genomes score near zero because they fall immediately" is not a claim
  the learner has to take on trust.
- A **select** stage drew three individuals all at fitness 0.000, so the winner was decided
  purely by draw order. That is selection pressure being visibly weak, which is the point
  of the stage and very hard to assert in prose.

### Deliberately not in this slice

No stepping backwards, no editing a genome mid-generation, no replaying an individual from
the stepper. The stage list is not clickable — stepping is forward-only, because a
generator cannot rewind and faking it would mean keeping a second copy of the algorithm's
state, which is the thing this slice exists to avoid.

---

## Slice 6 — Guided first run

> **Status: complete.** Two sessions.

### Goal

The onboarding flow of Fig 9.1: one decision at a time, preset goals, plain-language notes,
generation 1 shown falling over.

### Depends on

Slices 0–3, and slice 5 for the "show me how this works" entry point.

### Design

Stage state (`guided` / `explorer` / `lab`) is app state, freely switchable from the
toolbar, with nothing locked (§7 of the design document). It sets `data-stage` on `<body>`
and CSS decides which panels are present — `.explorer-only` hides in guided,
`.lab-only` hides in guided and explorer. Switching stages never restarts the search.

Four preset objectives, each a named weight vector over the fitness terms from slice 2.
Changing one rebuilds the pool, because islands take their objective at construction — and
because a new goal genuinely is a new search, which is what the learner means by it.

Four steps: pick a body, choose a goal, watch, see what changed. Step 4 compares the best
of generation 0 against the champion, which is why `RunState` carries `firstChampion`
separately — `champion` is overwritten the moment anything beats it.

### React was deferred, deliberately

The plan said "introduce React here, and not before — this is the first slice with enough
panel structure to justify it." Having built the panels, that is not true yet, and the
slice's own *Goal* and *Done when* say nothing about React.

The guided flow is a staged reveal driven by four booleans. Against that, introducing React
means a new dependency, a plugin, and porting roughly a thousand lines of working, tested
UI — for no user-visible change in this slice. Worse, the two heaviest surfaces actively do
not want it: the stage and the chart are imperative canvases redrawn from a `requestAnimationFrame`
loop, and putting 60 Hz run state into React state is precisely the wrong shape.

**The condition for React is slice 7, not slice 6.** The body editor is direct manipulation
over a tree of segments and joints, with per-joint inspectors, validation feedback and undo —
that is a genuine component tree with genuine shared state, and it is where the ceremony
starts paying for itself. Zustand arrives with it or not at all.

### Two things fixed after seeing it work

**A flow with no way through.** Steps revealed themselves as `done | now | next`, where
`next` meant collapsed. Step 3 only became `now` once the run had started — but the button
that starts the run lives inside step 3, so a first-time user was shown a goal picker and no
way forward. Fixed with a fourth state, `ready`: expanded and actionable but unbadged. It is
the sort of bug that is invisible when you know where the button is.

**Copy that asserted what had not happened.** The naive goal's afterword read "diving
forward and landing on its face beats walking" — and on the run I tested, the champion
walked and stayed upright for the whole trial. The lesson was fine; the sentence was a lie
about the screen the learner was looking at.

Afterwords are now **functions of the outcome**, not fixed strings:

```ts
afterword: (o) => o.fell
  ? `Look at what won. It fell after ${o.uprightTime.toFixed(1)} s and still scored best…`
  : 'This time the search found something that walks, which is luck rather than design…'
```

That is what §7 means by explanations "written against live values". Evolution does not
reliably misbehave, and copy that overclaims teaches the learner to stop reading it.

### Done when

- [x] A first-time user reaches an evolved gait without touching a slider.
- [x] The full interface is one click away, and nothing is locked in either direction.
- [x] Four goals, including the deliberately naive one, with the lesson withheld until
  after the run.

**Observed.** A guided run is 30 generations, 24 individuals, 4 s trials: **2,648 robots
tried in about 8 seconds**, first attempt 2.54 m, champion 6.27 m. Step 4's toggle replays
either, so the improvement is watched rather than read.

### Deliberately not in this slice

No challenge track, no per-concept progress, no persistence of what a learner has seen —
those are slice 11. The stage a user is in survives in the URL and nowhere else.

---

## Slice 7 — Body editor

> **Status: complete.** Three sessions.

### Goal

The morphology designer of Fig 9.3: edit segments and joints in a 2D sagittal view, with
live mass and torque readouts.

### Design

The editor edits a **`BipedSpec`** — lengths, widths, limits, torques, density — and
`buildBiped(spec)` derives the morphology from it, stacking upward from the ground.

That choice does most of the work:

- **The kinematic chain closes by construction.** Positions and joint anchors are computed
  from the same lengths, so there is no way to produce a body whose joints tear themselves
  together on the first step. The morphology test asserting anchor agreement can now only
  fail from a bug in `buildBiped`, never from a user edit, and `spec.test.ts` asserts it
  across 300 random specs.
- **The feet always rest exactly on y = 0**, so no body is born interpenetrating the floor.
- **Symmetry is not a lock, it is the type.** One spec describes both legs, so the two can
  never drift apart.

`simpleBiped()` is now `buildBiped(DEFAULT_SPEC)` and reproduces the slice-0 numbers
exactly — the mass guard, the chain-closure test, the physics walking test and
`npm run evolve` returning 6.4598 all pass untouched.

### The topology is fixed, and that is the interesting part

Seven segments, six joints, always. That is a real limitation, and it buys something worth
more than it costs: **the genome stays eleven genes whatever the body**, so a gait evolved
on one biped can be dropped straight onto another.

The plan anticipated the opposite — "changing the morphology changes the genome length
whenever the joint count changes… the UI must say so rather than silently producing
nonsense." Fixing the topology removes that failure mode entirely, and replaces it with the
best interaction in the editor: evolve a gait, lengthen the legs, watch it fall over.
Nothing else in the project makes the relationship between body and controller so obvious
so quickly. A variable-topology editor would have made it impossible.

### Validation is about whether a body can work

Structural coherence is guaranteed, so `validateBody` only reports things that would waste
the user's next eight seconds:

| Check | Level |
|---|---|
| Centre of mass outside the support polygon | error — it topples before it can step |
| Balance margin under 15 mm | warning |
| Hip torque below what holding the torso needs | error |
| Hip load over 70 % | warning |
| Joint limits that exclude the rest pose, or are degenerate | error |

The hip-load check is the one worth having: it is the same class of mistake as slice 1's
motor gains, caught before it costs a diagnostic session.

### What changing the body does and does not restart

Dragging a slider rebuilds the morphology and the **replay** immediately, so the champion
gait is re-run on the new legs as you drag. It does **not** rebuild the worker pool: every
fitness in it was measured against the old body, so the pool is marked stale and rebuilt on
the next Run. Rebuilding four workers on every slider tick would be unusable.

The stepper holds its own island and gets `retarget(morph)`, which discards the generation
in progress rather than comparing scores from two different robots.

### React, finally answered

The plan said React and Zustand arrive here. Having built the editor, they do not, and I am
closing the question rather than deferring it a third time.

The editor is a column of sliders, a readout block and a list of validation messages — the
same shape as the gait panel that has worked since slice 1. The three heaviest surfaces in
the app are canvases driven by `requestAnimationFrame`, which is precisely where React state
is the wrong tool. Porting roughly 1,400 lines of working, tested UI would buy component
syntax and cost a large refactor across six finished slices.

**This is an amendment to §12 of the design document, not an oversight.** The stack row
should read vanilla TypeScript with canvas rendering. If a future slice needs a third-party
React component or genuine component reuse, that is the moment to revisit — slice 9's
Three.js work does not qualify, since plain Three.js is a perfectly good imperative API.

### Done when

- [x] The body is editable, with live mass, height, balance margin and hip load.
- [x] Invalid bodies are explained rather than merely rejected.
- [x] A body round-trips through the URL, so one can be shared.
- [x] The reference body is unchanged — 130 tests pass, `npm run evolve` still returns 6.4598.

**Observed.** The reference biped is 21.1 kg, 0.92 m, 53 mm of balance margin, 12 % hip
load. Lengthening both leg segments to 0.42 m gives a 28.0 kg, 1.25 m body. Shrinking the
foot to 0.08 m while pushing the ankle offset to 0.12 m gives a margin of −74 mm and the
error "the centre of mass is outside the feet"; the biped visibly topples in the replay.

### Deliberately not in this slice

No IndexedDB, no revisions, no fork-on-edit — the URL is the only persistence, which is
enough for a project with one user and makes bodies shareable for free. §11's immutability
rule matters when runs are stored; nothing is stored yet.

No drag-on-canvas manipulation. Sliders with live readouts and a live replay give the same
feedback loop, and hit-testing rotated segments is a session of work for a nicer verb.

No per-leg asymmetry, no extra limbs, no variable topology — see above for why the last one
is a feature.

---

## Slice 8 — Behaviour archive

> **Status: built.** One session.

### Goal

MAP-Elites running alongside the GA: a 24 × 24 grid keyed by behaviour, each cell holding
the fittest genome that has ever behaved that way. The genetic algorithm answers *what is
the best gait?*; the archive answers *what kinds of gait are there, and how good is the best
one of each kind?* — which, for a teaching tool, is the better question.

### Depends on

Slice 2 (`evaluatePending`, where every trial passes through exactly once) and slice 4 (the
worker pool, which is what the delta protocol exists to serve).

### Design

Two descriptors, both **measured during evaluation and neither scored**:

| Axis | Range | Bins | What it is |
|---|---|---|---|
| stride length | 0 – 1.4 m | 24 | mean forward displacement between consecutive touchdowns of the *same* foot |
| duty factor | 0.5 – 1.0 | 24 | fraction of the trial each foot spent on the ground, averaged over both |

`TrialResult` gains `strideLength` and `dutyFactor`. Nothing in `score` reads either, which
is the entire point: the spread across the grid is a fact about what the search *found*, not
about what it was told to look for.

```ts
export function archiveInsert(
  archive: Archive, genome: Genome, behaviour: readonly [number, number],
  fitness: number, generation?: number,
): boolean;    // true if it claimed an empty cell or beat the incumbent
```

One offer per evaluation, made inside `evaluatePending` rather than at the end of a
generation — elites are never re-evaluated, so making the offer where the trial happens is
what stops a carried elite being counted every generation and quietly halving the reported
improvement rate.

### Foot contact is geometry, not an event queue

The obvious way to detect a footfall is Rapier's `EventQueue` or `world.contactPair`. This
slice does neither. The feet are boxes, the ground is a plane at y = 0, and the trial
already takes a snapshot every step — so the lowest corner of an oriented box,

```ts
y - (|halfWidth · sin θ| + |halfHeight · cos θ|) <= CONTACT_EPSILON
```

is cheaper, has no subscription to set up, and is trivially testable in Node. **Revisit when
the floor stops being flat** (slice 14): a box against a slope is still easy, a box against
arbitrary terrain is not.

`CONTACT_EPSILON` is 5 mm, and it was **swept rather than guessed**. Against the reference
champion, touchdowns per foot are a flat 7 for every threshold from 1 mm to 10 mm and
collapse to 3 at 20 mm, where separate steps begin merging into one. Duty factor drifts
0.78 → 0.84 across that flat region, so the number is not threshold-free — but it is stable
well either side of the value chosen, and that gait lifts its feet 58 mm and 135 mm, an
order of magnitude clear of any of it. A test asserts the clearance, so if a physics or
morphology change ever shrinks it, the descriptors do not quietly become threshold-dependent.

### The ranges came from measurement, and the first draft was wrong

The original sketch in this document said stride 0.15–0.95 m and duty 0.35–0.85. Both were
wrong, and running the thing is what showed it:

- **Duty 0.35 wasted two thirds of the grid.** 0.5 is the textbook line between walking and
  running, and it is a fine thing to anchor an axis to — but this morphology never gets
  airborne, so the first draft's rows 0–18 stayed permanently empty. The lower bound is now
  0.5 and rows 9–22 fill in a 30-generation run. The band that is still empty at the bottom
  is informative rather than wasted: it is the visible fact that this biped does not run.
- **Stride 0.95 was too low a ceiling.** The reference champion strides 0.92 m, so it would
  have sat in the last column with nothing above it. 1.4 m leaves headroom for the long runs.

Values outside a range **clamp into the edge bin rather than being discarded**. A gait
outside the map is still a gait; dropping it would make coverage read better than it is and
would hide exactly the outliers worth looking at.

### What counts as a behaviour

`behaviourOf(result)` returns `null` for a trial that fell, and the island skips it. This is
a judgement about what the map *means*, not an optimisation, and it lives in one named
function so that changing it is one edit:

> Descriptors from a robot that toppled at 0.4 s describe the topple, not a gait. Letting
> them in fills the corners with noise that no later genome can displace, because the
> incumbent's fitness came mostly from having survived.

So the map is a repertoire of gaits that hold up for a whole trial, and it starts empty
because at generation zero nothing does.

Ties lose. Equal fitness in an occupied cell keeps the older genome, which makes the map
stable to look at — a cell that stops changing has genuinely converged rather than churning
between equivalent genomes every generation.

### Four islands, one map

Each worker keeps its own archive and reports **only the cells that changed**, as five
parallel typed arrays that are transferred rather than cloned:

```ts
export interface ArchiveDelta {
  readonly index: Int32Array;       // flat cell indices
  readonly fitness: Float32Array;
  readonly behaviour: Float32Array; // 2 per index
  readonly genes: Float32Array;     // genomeLength per index
  readonly generation: Int32Array;
  readonly genomeLength: number;
}
```

The worker diffs against a shadow `Float32Array` of last-reported fitness per cell, seeded
with `NaN` so the first report of any cell always differs — the one occasion `NaN !== NaN`
is convenient. Comparing fitness is sufficient because ties lose on insert, so a cell whose
fitness has not moved has not changed. A generation typically changes single figures of
cells, a few hundred bytes; sending all 576 every generation would cost more than the search.

`IslandPool` folds every delta into one combined `Archive` via `archiveInsert`, **not** a
bulk copy, so a collision between two islands resolves under exactly the rule each island
used on itself. Islands are independent searches with different seeds and routinely find the
same cell, so this is the normal case rather than an edge one. The union is what is
displayed: per-island coverage would mostly show that four small searches each cover less
than one big one, which is true and not the point.

### Rendering

One `ImageData` at one pixel per cell, blitted into an offscreen canvas and scaled up with
smoothing off. The map changes a few times a second at four workers while the replay runs at
sixty, so `paintArchive` repaints only when `pool.archiveRevision` or the hover cell moves —
the difference between one blit a second and sixty. A grid of 576 divs would have spent more
time in style recalculation than the search spent evolving.

Colour is normalised to the **best cell in the map**, not to an absolute scale, because early
on the whole map is dim and that is exactly when it has the most to say. The consequence —
that colour is not comparable between two screenshots taken at different times — is why the
best cell's actual fitness is printed underneath.

Hovering a cell reports its stride, duty, fitness and the generation it was found.
**Clicking loads that genome into the sliders**, reusing the path *Copy champion to sliders*
already takes, and putting the gait somewhere the reader can take it apart — which is the
reason the archive stores genomes and not just fitness.

`npm run evolve` prints the same map as ASCII at four cells per character, so its shape is
visible without a browser.

### Two numbers worth more than best fitness

- **Coverage.** Best fitness can sit still for twenty generations while the map is still
  filling. A run ending with one brilliant cell and 575 empty ones has not explored,
  whatever its maximum says.
- **Improvement rate** (`improvements / attempts`). It falls steadily through a run, and
  watching it fall is a clearer signal that the search has stopped exploring than a flat
  best-fitness line.

### Measured

Single island, seed 4417, 30 generations — the golden run:

```
champion     fitness 6.4598      (unchanged — the archive does not touch the search)
  stride     0.923 m             (behaviour — not scored)
  duty       0.800               (behaviour — not scored)
archive      138 of 576 cells (24.0% coverage), QD score 547.7
  offers     547 trials survived to be filed, 293 claimed or improved a cell (54%)
```

Four islands in the browser, same 30 generations: **254 of 576 cells, 44.1% coverage**, best
cell 6.769, improvement rate down to 9% of trials by the end.

### Done when

- [x] `TrialResult` carries `strideLength` and `dutyFactor`, both measured from foot contact.
- [x] The contact threshold was swept, not chosen by taste, and the sweep is recorded.
- [x] `archiveInsert` claims, improves, and refuses ties; genomes are **copied** on insert.
- [x] Every island fills an archive; the pool merges four of them into one.
- [x] The map renders as a single `ImageData` blit and repaints only when it changes.
- [x] Hovering reports a cell; clicking loads its gait into the sliders.
- [x] `npm run evolve` reports coverage, QD score, improvement rate and an ASCII map.
- [x] The golden test still returns 6.4598, and a test asserts the population is bit-identical
      to a run whose archive is discarded every generation.

### Deliberately not in this slice

**Not a MAP-Elites *search*.** The archive is an observation of the GA, never an input to
it: nothing selects parents from the map, and a test drains one island's archive every
generation and asserts the population stays bit-identical. Real MAP-Elites would sample
parents from the grid, which is a different algorithm with a different convergence story and
would make the stepper — which draws tournament selection — a lie.

**No archive persistence.** Coverage resets when the body changes, which is correct: every
cell was measured on the old legs. Storing runs is §11's immutability rule and needs the
server.

**No third descriptor.** A 24 × 24 grid is legible at a glance; 24³ is 13,824 cells that a
662-trial run would leave 95% empty, and it cannot be drawn as one image.

**No per-island maps in the UI.** The union is the interesting claim. Per-island views are a
tab's worth of work whenever they are actually wanted.

---

## Slice 9 — 3D replay

> **Status: built.** One session.

### Goal

Watch the champion walk in a 3D scene with an orbit camera and a timeline scrubber, while
the 2D view stays exactly as it is. §9 of the design document.

### Depends on

Everything. The archive was the last slice that changed how the search works; this one only
changes how it is watched.

### Decided before the slice started: render in 3D, keep simulating in 2D

The alternative was real: move to `rapier3d`, give the morphology a third dimension and roll
joints, and let the biped fall sideways. That is more honest physics. It also invalidates
every fitness number in the project, re-pins the golden test, and costs a slice and a half
before anything walks again — all to buy a failure mode the eleven-gene sagittal genome has
**no way to correct**. The controller has no lateral term, so a robot that can fall sideways
will simply fall sideways, and evolution cannot fix it because nothing in the genome moves
in that axis.

The cost is visible and is not hidden: orbit round to the front and the legs are perfectly
aligned laterally, because they can never be anything else.

This is now **written into the design document**, as `.amend` blocks in §2 (which named
`rapier3d` in its decision), §4 (which specified the engine and budgeted for a full-3D mode)
and §9 (whose mockups all show a 3D robot). The two full-3D rows in §4's throughput table are
tagged *hypothetical* rather than deleted, because the derivation is still the honest basis for
the 2D-versus-3D comparison the surrounding prose draws.

Revisit only if the genome grows a lateral term.

### What was built

```
apps/web/src/render/three/
  bodies.ts     Snapshot → boxes. Imports nothing from Three. Tested under Node.
  scene.ts      The only file in the project that imports Three. Dynamically imported.
  controls.ts   Orbit and scrubber. Hand-rolled.
packages/sim/src/record.ts    the trajectory format
```

**The split between `bodies.ts` and `scene.ts` is the point.** Every decision about how a 2D
sagittal simulation becomes a 3D scene — where the legs sit in z, how deep a box is, what the
camera looks at — is arithmetic on a `Snapshot`, so it lives in a module with no Three import
and is checked in Node without a WebGL context. `scene.ts` is only the part that can be
verified by looking at it. If `bodies.test.ts` ever becomes impossible to write, the render
layer has stopped being separable.

### Recording

`evaluate` gained one option and it is **off by default**:

```ts
evaluate(morph, genome, { seed, seconds, record: true })   // → TrialResult & { recording }
```

Overloads, so `record: true` narrows the return type and the search's call site is unchanged.
Sampled at 60 Hz — every fourth physics step, the same cadence the controller runs at, so a
recorded frame always lands on a tick where the joint targets had just been set rather than
midway through the motors chasing them. A 4-second trial is about 40 kB.

Flat typed arrays with a stride, not an array of frame objects: 240 frames of 7 bodies is
1,680 little objects that exist only to be read once by a renderer.

**The format is deliberately wider than the 3D replay needs.** It carries joint angles and
per-foot contact flags as well as poses, because slice 10's joint-angle traces and footfall
diagram read the same recording and re-running every trial later would be silly. A test
asserts the recorded contact agrees with the duty factor the archive keys on — if those ever
drift apart, slice 10's diagram would contradict slice 8's map.

`snapshotAt(recording, frame)` rebuilds a `Snapshot`. That is what lets one scrubber drive
both renderers: both take a `Snapshot`, so neither knows a recording exists, and they cannot
interpolate the trajectory differently and drift apart at exactly the moment someone is
comparing them frame by frame.

### Two replay sources, and the mode picks

- **Manual gaits play live.** Dragging a slider and watching the stride change on the next
  step is the whole feedback loop the sliders exist for; restarting a recorded trial on every
  input event would destroy it.
- **Champions play from a recording**, at twice the trial length. A champion changes rarely,
  and a recording is the only thing that can be scrubbed.

The scrubber appears only when a recording exists. Dragging it pauses, because a playhead
that runs away from the finger is useless.

### Two bugs the browser found

- **The camera eased into a seek.** Scrubbing to 5 s moves the robot eight metres between one
  frame and the next, and a camera that lerps at 0.12 per frame spends half a second showing
  empty grid — which reads as the seek having broken. It now snaps when the jump exceeds
  1.5 m and smooths otherwise.
- **The legs were outside the torso, not under it.** The first `lateralOffset` used the
  torso's full half-width, which put the leg *centres* on the torso's side faces and gave the
  robot a permanent wide stance that read as a deformity. Half of it puts a thigh's outer face
  flush with the torso's side and its inner face on the centreline. Derived from the torso
  either way, so the body editor's width slider moves the legs with it.

Also worth recording: Vite warned that `controls.ts` was imported both statically and
dynamically, so it never moved into its own chunk. The dynamic import was pointless —
`controls.ts` imports only a *type* from `scene.ts` and so pulls in no Three at all. Only
`scene.ts` needs to be dynamic.

### Measured

```
dist/assets/index-*.js    1,608 kB     the app, including Rapier's inlined WASM
dist/assets/scene-*.js      517 kB     Three, in its own chunk, loaded on first 3D open
npm run evolve            9.24 s       was 9.37 s before recording existed
champion fitness          6.4598       unchanged
```

The throughput figure is the evidence for the claim that `record` unset costs nothing; the
difference is inside run-to-run noise.

### Done when

- [x] A 3D tab shows the champion walking, orbitable, with a ground plane and a grid.
- [x] Three is dynamically imported and absent from the initial bundle — its own 517 kB chunk.
- [x] The 2D view is untouched and remains the default.
- [x] A scrubber seeks to any frame of a recorded trial and the 3D and 2D views agree on it —
      verified by seeking to frame 300 and switching views: same pose, 7.75 m, 5.00 s in both.
- [x] `record: true` produces frames; `record` unset produces no `recording` property and the
      trials/s benchmark has not moved.
- [x] A test steps a fresh sim alongside a recording and asserts every body, joint angle and
      distance matches at all 121 frames — the recording *is* the trajectory, not a resample.
- [x] `npm test` passes (165) and the golden number is still 6.4598.

### Deliberately not in this slice

**No 3D physics.** See above; the reasoning is in §9 of the design document.

**No ghost overlays, footfall diagram or joint traces.** Slice 10, and they all read the
recording this slice defines. `MAX_INSTANCES` is already 64 rather than 7 so the instanced
mesh does not need rebuilding when they arrive.

**No shadow map, no textures, no mesh import.** A grey box robot on a grid reads better for
teaching than a styled one, and shadows on an instanced mesh are a session of work for no
clarity.

**No `OrbitControls` from `examples/jsm`.** It is 1,300 lines handling touch pinch, damping,
pan limits, keyboard and auto-rotate. What this needs is drag, wheel and a clamp at the poles
— forty lines, and no second import path to keep bundled and typed. Take the library when the
view grows a reason to need the rest.

**`ThreeView.dispose()` is written but uncalled.** The view is created once and lives for the
session; it holds no morphology, so not even the body editor can invalidate it. It exists
because the first thing that *does* tear a scene down is slice 10, and writing it while the
allocation sites are in front of us is cheaper than reconstructing the list later.

---

## Slice 10 — Gait analysis

> **Status: built.** One session. As predicted, almost entirely drawing.

### Goal

Three read-outs of *how* a gait works, sharing one scrubber with the replay — a footfall
diagram, joint-angle traces, and a hip phase portrait. Fig 9.7 of the design document.

### Depends on

Slice 9's `Recording`, and nothing else. Every number here was already captured:

| Panel | Reads | Drawn as |
|---|---|---|
| footfall diagram | `contact` — `frames × 2` | two lanes, filled where the foot is down |
| joint-angle traces | `jointAngles` — `frames × joints` | six series, one shared y-axis, degrees |
| phase portrait | `jointAngles` for `hipL`, differentiated | angle against rate, fading with time |

**Nothing re-runs.** A test asserts it: every file under `render/gait/` is scanned for
`evaluate(`, `new Sim` and `stepControlled`, and the only runtime imports permitted from
`@evolab/sim` are the two duty helpers. That is a crude test and it guards the one property
the whole slice rests on — the moment a panel simulates, watching a gait costs as much as
evolving one and the panels start competing with the search for the main thread.

### One time axis, shared

`common.ts` owns `frameToX` and `xToFrame`, and the footfall diagram and the traces both
import them. They sit stacked in a single grid column so their widths are identical, which
means their time axes are identical, which means **a reader can draw a vertical line down the
two with their eye.** If each computed its own mapping, two panels a few pixels apart would
disagree about where 2.4 s is and the stacking would be pointless.

`xToFrame` is the exact inverse of `frameToX`, so clicking a footfall bar seeks to the frame
under the pointer rather than near it — verified at 75% along the axis landing on frame 180
of 240. Clicking pauses, exactly as dragging the scrubber does.

There is **one frame index in the app**, `playFrame` in `main.ts`. The panels are passed it;
none keeps a copy.

### The recording now matches the trial that was scored

Slice 9 recorded `trialSeconds * 2`, inherited from what the live replay used to loop at.
That was fine while the recording was only a picture. It stopped being fine the moment this
slice printed a **duty factor** on the footfall diagram, because the behaviour map prints one
on the cell beside it — and measured over eight seconds of a four-second trial they disagreed,
0.83 against 0.80, with nothing on screen to explain why.

`respawn` now records exactly `trialSeconds`. The scrubber shows *the run that produced the
numbers next to it*, rather than a longer run that resembles it. The four seconds of extra
walking were worth less than the two figures agreeing.

A residual gap of about half a percentage point remains and is not a bug: the trial counts
stance at 240 Hz and the recording stores it at 60 Hz, so a touchdown landing between samples
rounds to the nearest frame. The footfall caption states the window it measured over, and the
test bounds the gap at one percentage point **explicitly** rather than via
`toBeCloseTo(_, 2)` — that allows 0.005 and the measured gap is 0.0047, which would have made
the test fail on a breeze rather than on a regression.

### Where it went

A strip under the stage, 192 px, present only when a recording exists. In manual mode the
replay is live and there is nothing to scrub, so the panels are **absent rather than blank** —
and recording on every slider drag is precisely what slice 9 avoided.

The split between the footfall diagram and the traces is not even: two stance bars need far
less height than six overlaid curves. Footfall is a fixed 76 px and the traces take the rest.

The stage loses 192 px, down to 666 px at 1440 × 900. The 3D view still frames the robot with
room to spare, which was the thing the previous slice's notes said to check.

### Decisions worth keeping

- **One shared y-axis for all six joint traces, not six strips.** The comparison worth making
  is *between* joints — the hip leads, the knee follows, the ankle does almost nothing on most
  evolved gaits. Six separate scales would hide exactly that by making a 4° ankle wiggle look
  the same size as a 40° hip sweep.
- **Colour by joint kind, dashed for the far leg.** Three shapes to track, not six.
- **Degrees on the traces**, radians everywhere else in the project. Nobody reads a gait in
  radians, and this panel exists to be read.
- **`dutyFromRecording` lives in `packages/sim`**, not in the renderer, so the number printed
  on the diagram and the number the archive filed are the same function and a test can hold
  them against each other.
- **The phase portrait was kept.** It teaches least and looks most impressive, exactly as the
  sketch predicted. It earns its place on one property the footfall diagram cannot show:
  periodicity. A converged gait draws a closed loop; one still falling over draws a spiral
  that never closes.

### The legs are one colour everywhere

The footfall lanes identify themselves by wearing the colours the robot wears. They did not,
at first: the diagram used cyan and violet while the 3D robot wore cyan and a dim teal, so the
right lane was a colour no leg had — and on the fitness chart violet already means *diversity*.
A reader had nothing to connect the bar to and could only trust the text label, which is
exactly the doubt that surfaced it.

Copying the scene's dim teal into the diagram fixed the mismatch and created a worse one. A 3D
scene may shade the far leg, because lighting already says *further away*; a chart may not,
because its two lanes carry equally important data and dimming one says otherwise. The right
lane became measurably harder to read — 292 against 442 in summed channel luminance.

So the robot moved instead. Both legs are equal-weight and distinct in both places, and the
far leg is easier to follow while it walks as a side effect. Two tests guard it: one asserting
the two files' palettes match and the hues differ, one bounding the luminance ratio at 1.3.
The first was mutation-tested by reintroducing the dim teal and watching it fail.

### A bug the tests found

`xToFrame` could name a frame that does not exist. The `max(1, …)` guarding against a
divide-by-zero on a one-frame recording let a click at the right-hand edge return frame 1 of a
recording that only has frame 0. Harmless downstream — `snapshotAt` clamps too — but a
function that can name a frame nobody has is a trap for the next caller. Found by writing the
single-frame test, not by seeing it.

### Done when

- [x] Footfall diagram, joint traces and phase portrait draw from a `Recording`.
- [x] All three share the replay's scrubber and its playhead, with no second time source.
- [x] The duty factor on the footfall diagram matches the archive's number for the same
      genome — bounded in a test at one percentage point, with the sampling gap explained.
- [x] Nothing in the slice calls `evaluate` — asserted structurally over the source files.
- [x] The panels are absent, not blank, when there is no recording.
- [x] Click either time panel to seek; 75% along the axis lands on frame 180 of 240.
- [x] 174 tests pass and the golden number is still 6.4598.

### Deliberately not in this slice

No CSV or JSON export. The server is slice 12, and export without somewhere to put it is a
menu item nobody clicks.

No comparison of two gaits side by side. That wants two recordings and a diffing UI, and it
fits much better once the community archive exists.

**No ghost overlays.** They belong in the 3D view rather than here. `MAX_INSTANCES` is already
64 against a 7-body biped, so up to eight ghosts fit without touching `scene.ts` — but
`coloured` in its render loop is a one-shot flag and will have to become per-instance.

**No fourth behaviour descriptor**, however easy the traces make one look. A 24 × 24 grid is
legible; a third axis is 13,824 cells and cannot be blitted.

---

## Slice 11 — Challenge track

> **Status: built.** One session. The first slice since 6 that adds teaching rather than
> instrumentation.

### Goal

§7's concept ladder expressed as work rather than as lessons: eleven cards, each naming the
concept it teaches, each configuring the app so the learner runs into that concept and cannot
miss it. Fig 9.2.

### The concept audit, and what it found

Settled before any code was written, which was the right call — one of the three findings is
permanent and would have been expensive to discover halfway through.

Of §7's fifteen concepts, **twelve are covered by the eleven cards** and three are not:

- **Multi-objective** needs a Pareto front that is not built and is not planned.
- **Stability margin** needs slice 14's terrain.
- **Symmetry is impossible by construction.** `gaitTargets` reads `params[joint.kind]`, so
  both legs share one amplitude, phase and centre and differ only by a half-cycle offset in
  `SIDE_PHASE`. **This robot cannot limp.** An asymmetric gait is not unimplemented, it is
  unrepresentable in eleven genes — and eleven genes is what lets a gait transfer between
  bodies, which is the best thing in the body editor. The concept goes, not the genome.

A test pins the count at twelve, so shrinking the ladder is a deliberate act rather than a
drift.

That audit also caught **Appendix B of this document describing a genome layout that was
never adopted** and reading as fact. It is now marked as the design that was considered.

### The afterword format is the whole slice

Slice 6 established the rule and this slice had to encode it: copy asserting that the robot
face-planted, shown after a run where it plainly walked, **teaches the reader to stop
reading**. Presets solved it by making the afterword a function of the outcome. Challenges are
data and cannot hold functions, so the branch moved into the format:

```ts
type Afterword =
  | { readonly text: string }
  | { readonly when: Check; readonly then: Afterword; readonly otherwise: Afterword };
```

`{placeholder}` and `{placeholder:2}` interpolate against the same `Outcome` the checks read.
That is the entire template language, on purpose — anything richer becomes a small expression
evaluator to test and defend.

Three tests guard it, and each guards a mistake that would otherwise ship:

- every placeholder in every card names a field that exists — a typo prints
  `{championDistnce}` at a learner the first time the card fires and only then;
- every branch of every card renders with no placeholder left behind;
- the naive card says something true whether or not evolution misbehaves, and the walking
  branch is asserted **not** to mention falling.

**Every metric is a number, including the booleans.** `championFell` is 0 or 1, so `Check`
needs one comparison shape instead of two. The cost is `championFell == 1` in the data; the
gain is an evaluator that is fifteen lines and cannot grow a second code path.

### Two cards found real problems

**Card 4, the naive objective**, ran and evolution *behaved itself* — it walked 6.1 m without
falling. That is the case the branching format exists for, and the panel said so: *"this is
luck rather than design: nothing in this goal rewarded staying upright."* Had the copy been
fixed text, the slice's own central lesson would have been undermined the first time it ran.

**Card 6, elitism**, was written with an unconditional *"The line dips."* It does dip — the
run measured **five dips, the largest 0.512** — but with four islands that is likely, not
certain. Asserting it would have been exactly the failure the slice is about. `Outcome` gained
`bestDips`, counted from the chart's own series so the number quoted is the number the learner
can see, and the card now branches. The honest alternative branch is better teaching anyway:
*a guarantee is not the same as having got away with it.*

The phrasing needed care too — `'{bestDips} times'` prints *"1 times"* on the run where the
lesson only just happens. It reads "went down on {bestDips} of the generations you just
watched" instead.

### The stepper runs its own island, and two cards were broken by not knowing that

Cards 2 and 3 tell the learner to open the stepper and watch an operator. Both originally
checked `generations >= 1` — which counts the **worker pool's** generations.

`createStepper` builds its own `Island`, and that is deliberate: it needs synchronous control
of a generation, and the pool's islands live in workers. The two searches share nothing. So
stepping never moved the number the cards were watching, and since neither card sets `gens`,
the target stayed at whatever the previous card left it. Completing card 2 silently required
closing the stepper and running thirty generations of an unrelated pool. **Doing exactly what
the card asked completed nothing.**

`StepperOptions` gained one callback, `onStage`, reporting each operator as it is stepped
past — the only wire between the stepper and the track — and `Outcome` gained
`stepperSelections`, `stepperCrossovers` and `stepperMutations`.

Those three are **the only outcome fields not measured from a run**, and they are deliberately
not persisted. The point of the cards is that you *saw* the operator happen; a count restored
from `localStorage` would assert that about somebody who had not.

Checks now also run when the stepper advances, not only when a run reaches its target — a
stepper card has no run to end. Card 2 completes on the third step and card 3 on the fourth,
which is exactly when `select` and `crossover` appear.

**Ending a run and completing a card are separate**, and conflating them is a mistake worth
recording because it was made and nearly shipped. The first fix returned early from
`settleChallenge` when the check failed, which meant a failed attempt showed no afterword at
all — and the `otherwise` branches are where the teaching lives. A learner whose robot fell
needs the explanation *more* than one whose robot walked. `finishRun` now sets the afterword
due unconditionally and then asks, separately, whether the card is complete.

### The track had to fit without scrolling

Eleven cards in a 236 px column came to 1,193 px against 858 px of space, and the measurement
said where it had gone: **eleven titles are 299 px and eleven briefs are 601 px.** Two thirds
of the overflow was explanatory text on cards the reader was not looking at.

A vertical carousel was considered and rejected. It removes the scrollbar by showing one card
and hiding ten, which is the opposite of what Fig 9.2 is for — the track exists to be visible
as a curriculum, and *what do I understand now* stops being answerable at a glance. Reaching
card 9 also becomes eight steps, or a jump list, which is the list that was just removed.

Three changes instead, and the list now ends 238 px clear of the bottom:

- **A collapsed card is its title.** Brief, task and concept chips belong to the open card.
- **A concept strip**, twelve dots in ladder order, filled as each is understood. It answers
  §7's question in twenty pixels and stays put while the list moves; clicking one opens its note.
- **Four phase subheads** — *How the algorithm works*, *What you are asking for*, *Making the
  search work*, *How to read a gait*. Eleven tasks in a row read as eleven unrelated things;
  grouped, they read as four ideas, which is what the ladder actually is. Four rather than the
  three first sketched, because the fitness-design pair is the payload of the whole track and
  reads badly bolted onto the mechanics.

The open card is scrolled into view when it changes, and **only** when it changes — doing it on
every repaint yanked the list back each time a run reported a generation.

The column as a whole still scrolls, because the gait sliders sit below the track. That is
deliberate: card 9 asks the reader to click an archive cell and watch that gait load into those
sliders, so hiding them would break its payoff.

### Progress is per concept

§7 and Fig 9.2 note 4: the panel answers *what do I understand now*, not *how much have I
completed*. So the record is a set of concept ids and the cards are only how they were
reached — two cards teaching `fitness-design` mark one concept between them.

This is **the first state in the project that cannot live in the URL**. One `localStorage` key,
a few hundred bytes. Not Dexie, not OPFS: §11's immutability rules matter when *runs* are
stored, and this is not that.

The parse is defensive because `localStorage` is user-writable and outlives any version of the
file that reads it. Junk degrades to an empty record rather than throwing on boot and taking
the app down before the first frame; a partly broken record keeps its good half; storage being
unavailable entirely means the app forgets rather than fails. Six tests cover those paths.

Dismissing an explanation is **permanent per concept** (§7). The note still opens if it is
wanted; the dismiss button is simply not offered twice.

### Nothing is locked

Cards past the frontier are dimmed and remain clickable. Two rules that took a second pass:

- **A completed card is never dimmed.** The first version dimmed anything past the frontier,
  so finishing card 4 and then opening card 1 faded the completed one. Fading finished work
  reads as "this no longer counts", which is the opposite of what a progress panel is for.
- The dimming is a suggestion about order, not a permission system — §7's decision on freely
  switchable stages applies to the track too.

### Plumbing

`spawnPool` passed only `size`, `trialSeconds` and `objective`. `RunState` gained
`gaOverrides`, spread last so a card wins and omitted keys fall through to `DEFAULT_CONFIG`
rather than to an explicit `undefined`. The permitted keys are deliberately three — `elites`,
`mutationRate`, `tournamentSize` — because a card that could set `size` or `trialSeconds`
could silently make its own run incomparable with every other number on screen.

Verified end to end: card 6 sets `elites: 0` and the best-fitness line measurably falls, which
it cannot do on any other run in the app.

### Files

```
apps/web/src/challenges/
  types.ts        Challenge, Check, Afterword, Outcome — OUTCOME_KEYS is the runtime list
  check.ts        evaluation, interpolation, branch selection. Pure, Node-tested.
  data.ts         the eleven cards
  notes.ts        twelve concept notes
  progress.ts     concept ids in localStorage, defensively parsed
  track.ts        the panel — Fig 9.2
```

`OUTCOME_KEYS` is an array with the type derived from it, not the other way round, because a
test needs to check placeholders at runtime and a type alone could not.

### Done when

- [x] Eleven cards render as a track, each naming its concepts, later ones dimmed not locked.
- [x] Opening a card configures stage, goal, seed, generations and GA knobs in one click.
- [x] Success is evaluated from the run outcome — or, for the two stepper cards, from the
      operators actually stepped past — and marks concepts, not cards.
- [x] Afterwords interpolate live values and branch; both branches of cards 4 and 6 are tested.
- [x] Every referenced concept has a note and every note is reachable — both directions.
- [x] The challenge data round-trips through `JSON.stringify`.
- [x] Every afterword placeholder names a field that exists.
- [x] Progress survives a reload; dismissals stay dismissed.
- [x] 211 tests pass and the golden number is still 6.4598.

### Deliberately not in this slice

**No multi-objective, no stability margin, no symmetry** — see the audit. §7's ladder should
be annotated rather than quietly under-delivered.

**No general-purpose objective weight sliders.** Card 5 switches goals rather than terms. Full
weight control belongs with multi-objective, if that ever arrives.

**No authoring UI.** §6 imagines users writing their own tasks in v1.1. There is one user and
he can edit a TypeScript file.

**No server, no sync, no accounts.** Progress is `localStorage` until slice 12 gives it
somewhere to go.

---

## Slice 12 — The server

> **Status: built.** Two sessions. .NET 9 rather than §5's .NET 10, because 9 is what is
> installed and nothing here needs 10.

### Goal

Runs outlive a browser profile, and a gait can be shown to somebody. One ASP.NET Core
project, eight endpoints, a SQLite file. §5 of the design document.

### The rule held

**The app works with no server at all** — measured, not asserted. With the server killed
mid-session: thirty generations still evolved to 6.769, **zero unhandled rejections**, no
dialog, no console noise, and the only visible difference was one amber dot in the toolbar.
`npm run dev`, `npm test` and `npm run evolve` all work with .NET absent; `dotnet test` does
not need Node. Two toolchains, two commands, no orchestration between them.

### Errors are data, and the six failure modes are tested

`api.ts` never throws, so there is no `try`/`catch` anywhere else in the app. A rejected
`fetch`, a timeout, a 404, a 500, an HTML error page from a proxy and a 200 with unparseable
JSON all become an `ApiResult` — and the last two are the ones that get skipped, so they have
tests. Every request carries a five-second `AbortController`: a hanging request produces no
error to report *and* no result to use, which is the only outcome worse than failing.

The server sends RFC 9457 `ProblemDetails` with a stable `code` extension and honest status
codes. A test asserts an unhandled exception leaks no message, no stack and no file path.

Fig 9.9 is built as drawn: no indicator at all while the server is healthy or absent, one
amber dot when something failed, and the last five failures with `code`, status and `traceId`
behind it.

### Repositories earned their keep, then showed their limit

Eleven endpoint tests run against fakes with no database and no disk, exactly as specified.
`Program.cs` skips the `DbContext` entirely when a host supplies its own repositories — the
claim those interfaces make, demonstrated rather than asserted.

**Then the fakes let a bug through, and it is the most useful thing in the slice.** Listing
orders by `CreatedAt`; the fake orders in LINQ-to-Objects, which sorts a `DateTimeOffset`
happily. SQLite refuses to translate that at all. Every endpoint test passed against a query
the real provider will not run, and the server 500'd the first time it was started by hand.

`CreatedAt` is now stored as UTC ticks, and `RepositoryTests` runs against real in-memory
SQLite. Mutation-tested: removing the conversion fails two tests with the original
`NotSupportedException`.

> **Fakes prove endpoint behaviour and cannot prove persistence behaviour.** Both are needed
> and neither substitutes for the other. The acceptance criterion "every endpoint has a test
> against fakes" was necessary and not sufficient, and it now says so.

### A run is copied, never recomputed

`runPayload` is pure and tested in Node. The objective weights travel **as numbers, not just
the preset key** — presets are copy and copy gets reworded, and a stored run must always be
able to say what it was actually scored on. The same rule as `IslandConfig.trialSeed` in
slice 2.

Filled archive cells only: an empty cell is the absence of a behaviour, not a behaviour, and
576 nulls would triple the payload to say nothing. A real run stores 244 cells and 31
generations of chart.

Two details found by writing the tests: the naive preset's `effortBudget` is
`MAX_SAFE_INTEGER`, which is not a number to put in a database column, so it clamps; and a
non-finite champion field would become `null` through `JSON.stringify` and lose the whole run
over one bad value, so it rounds to zero instead.

### Opening a stored run does not restore the archive

The body, the champion gait and the chart come back — the three things that make a run
recognisable. The behaviour map does not. The pool's archive is an *observation of a live
search*, and filling it from a file would make coverage a claim about a search that is not
running. Slice 8's rule, still holding.

### `?shared=<token>` is §10's monitor mode, as §5 can deliver it

A finished run, replayed read-only, with no account and no history. Verified end to end: saved
a run, published it, opened the link, watched the gait.

Not live. §5 deleted SignalR along with the cloud islands, so a phone cannot subscribe to a
desktop session. **§10 is now amended** — the fourth such block in the design document — and it
settles three things rather than one, because writing it out showed the row was wrong in every
column: monitor mode is a finished run replayed read-only *at any width*; evolution never becomes
remote, since there is nothing remote to run it on; and editing never becomes read-only, because
once the panels overlay rather than disappear, *inspect & tune only* would mean hiding a control
that is already on screen and already works.

Two of the four breakpoints are tagged `superseded` in place rather than rewritten, on the same
principle as §4's `hypothetical` rows: the derivation is still worth reading even when the
conclusion has moved. The one rule that survived intact is the touch-device worker cap, which
`defaultWorkerCount()` implements exactly as specified — and which is not a breakpoint rule at
all, since it applies to a tablet at 1400 px too.

### Measured

```
POST /api/runs        244 archive cells, 31 history points, 6.12 m champion
GET  /api/runs        newest first — the query that 500'd before the ticks conversion
publish → shared      anonymous, 200, replays in a browser with no state
server killed         30 generations, 0 unhandled rejections, 1 amber dot
tests                 244 Node, 16 .NET
```

### Done when

- [x] `dotnet run` serves the built SPA at one origin; every slice 0–11 feature works through it.
- [x] `npm run dev` and `npm test` work with .NET not installed; no npm script references it.
- [x] A finished run round-trips: upload, list, fetch, replay.
- [x] A trajectory endpoint stores by content hash and does not duplicate the same bytes.
- [x] Publishing mints a token; the shared URL replays read-only with no account.
- [x] Killing the server leaves the app fully usable — no dialog, no unhandled rejection, no
      `try`/`catch` outside `api.ts`.
- [x] All six failure modes produce an `ApiError` rather than an exception.
- [x] No exception message, stack trace or file path appears in any response body.
- [x] Every endpoint has a test against fakes — **and** the repository has tests against real
      SQLite, which is the half the original criterion missed.
- [x] The golden number is still 6.4598.

### Deliberately not in this slice

**No community archive** — slice 13, and `archiveMerge` already does the hard part.

**No accounts, no OIDC.** A share token is an unguessable GUID and that is the whole security
model. Anything reachable by token is public, which is why nothing personal goes in a run.

**No live monitoring, no SignalR.** Polling is the cheap answer if it is ever wanted.

**No Docker, no CI, no migrations beyond `EnsureCreated`.** One SQLite file on one machine.

**No trajectory upload from the browser yet.** The endpoint and the store exist and are
tested; nothing calls them. Slice 9's recordings are still discarded when a champion changes,
and wiring that up wants the run-detail view that does not exist.

### The mistake worth recording

The data directory defaulted to `ContentRootPath/data`, which on a case-insensitive filesystem
is the same directory as the source folder `Data/`. The SQLite file landed among the entity
classes, and a `rm -rf data` then destroyed three source files that had not yet been
committed. They were rewritten from context, but the lesson is cheap to keep: **runtime state
never goes inside the source tree.** It now lives in `server/.data`, dot-prefixed so it cannot
collide with a C# folder and is obviously not source.

---

## Slice 13 — Community archive

> **Status: built.** One session. §5's last two endpoint rows, and the one idea §15 says is
> worth taking out of the classroom feature.

### Goal

Publishing a run contributes its elites to a shared grid, and the behaviour map gains a
**Mine / Everyone** toggle. A solo learner sees the space of gaits found by everyone who came
before them, next to the handful their own run found.

§15 makes the argument: *"thirty people's elites merged into one grid, showing that the room
found six genuinely different ways of walking."* Decoupled from a cohort it needs no roster, no
accounts and no minors — a genome is eleven numbers and carries no personal data at all.

**It worked the first time it was pointed at real data, and the numbers are the slice.** One
published run put 244 cells in the map. A second run at a different seed found 83 cells of its
own, **36 of which the first run had already found** — so 47 were new, and 208 of the shared
244 were ways this search never discovered. That is quality–diversity stated in two integers,
and no amount of explanation lands it as well.

### The merge happens on publish, and that is a bound rather than a preference

Merging **on read** does not survive arithmetic: each run stores up to 576 cells, so 200
published runs is 115,000 rows to reduce on every page load to produce at most 576. Merging **in
the browser** — the sketch's phrasing, and attractive because `archiveMerge` already exists —
fails on the same arithmetic from the other end.

So the community archive is **a stored thing, not a query result**: one table keyed by grid
index, so it physically cannot exceed 576 rows however many runs are published. §5's endpoint
table already said so — `POST /api/runs/{id}/publish` is described as *"mint a share token,
contribute elites to the community archive"*, one action with two effects.

Measured: 244 cells is a **78 kB** response, so a full grid tops out around 185 kB, fetched once
when Everyone is first selected.

### `archiveInsert` is written twice, and only one test can tell

`CommunityArchive.ContributeAsync` is the insertion rule in C#: *higher fitness wins, ties keep
the incumbent*. That is a real cost, and the response is a test rather than an architecture.

**The tie is the case worth pinning**, and mutation-testing showed exactly who catches it.
Changing `>=` to `>` fails `A_tie_keeps_the_incumbent` in `CommunityRepositoryTests` — and
leaves the endpoint-level tie test green, because the fake carries its own copy of the rule.
Fakes agree with whatever you tell them.

The tie direction is also what makes republishing a no-op: a run's own cells tie with
themselves, so a second publish changes nothing.

### Contribution is reported as ownership, not as a delta

Which follows from the above. Publishing twice returns the same token and must report the same
contribution — and a delta cannot, because the second call changes nothing and the honest delta
is zero.

So the number is **how many shared cells this run currently owns**, out of how many the map
holds: *"This run holds 62 of the 294 cells in the shared behaviour map."* Verified idempotent
by clicking Share twice and reading the same sentence.

### The stored index is authoritative, and finding out cost a cell

`buildCommunity` first re-derived each cell's bin from the stride and duty beside it. 244 cells
arrived and **243 appeared on screen**.

`serialise.ts` rounds the behaviour to four decimals for the wire. A stride of 0.87499 is stored
as 0.8750, which is exactly a bin boundary at 24 bins over 0–1.4 — it re-derives one column to
the right and lands on its neighbour. One cell silently lost, and it would have been thousands
on a full map.

**A bin is decided once, from the full-precision behaviour, when the cell is claimed.** The same
family as `IslandConfig.trialSeed`: if a decision survives, the conditions it was made under
must not change. `archiveInsert` now delegates to a new `archivePlace`, which takes the index
rather than deriving it, so the tie-breaking rule is still written exactly once and the golden
6.4598 is unchanged.

`archiveMerge` still re-derives, and that is safe: its inputs are in-memory archives whose
behaviours were never rounded.

### Everyone mode is the same canvas, and your cells are outlined

The toggle swaps which `Archive` `drawArchive` is handed. Same grid, same axes, same colour
ramp, same click-to-load. `drawArchive` gained one optional `ReadonlySet<number>` of indices to
outline — not a notion of *community*, which it does not need.

The outline is `overlapOf(mine, theirs)`, computed in the browser from the two archives it
already has, so it needs no provenance at all. Adjacent marked cells share edges and read as one
outlined region, which is the better picture: your run occupies a patch of the space rather than
a scatter of dots.

**The repaint key includes the pool's revision in both scopes.** The first version keyed the
shared map on a constant, on the grounds that it never changes on its own — and the outline over
it then sat frozen at whatever it was when the map was fetched, while the search underneath it
kept finding cells. The caption counts the same cells and refreshes with them.

### A genome only means something against a body

Slice 7 fixed the topology at six joints so a gait could be dropped onto a different set of
legs. Here it happens with somebody else's robot, so a community cell carries its run's
`BodySpec` and clicking one says which case it is:

- same body → *"Loaded. Same body as yours, so it should behave as it did for them."*
- different → *"…The genome is eleven numbers and it does not know how long your legs are, so on
  this robot it may not walk at all"*, with a button that adopts their body.

Both verified by hand. Loading their body silently would throw away the reader's own edits;
saying nothing would make the app look broken at the exact moment it is being most instructive.

### `EnsureCreated` does not upgrade, and 30 passing tests could not say so

**The most instructive failure in the slice, and the same shape as slice 12's.**

`EnsureCreated` builds the schema only when the database file does not exist. The new table
never appeared in the database slice 12 had created, so every `GET /api/archive` returned
`SQLite Error 1: 'no such table'` — while all 30 tests passed, because every test builds its
database from scratch.

> Slice 12: **fakes prove endpoint behaviour and cannot prove persistence behaviour.**
> Slice 13: **a database built fresh in a test cannot prove upgrade behaviour.** The tests
> create the world as it should be; reality arrives as it already is.

Full migrations do not fit: a database created by `EnsureCreated` has no
`__EFMigrationsHistory`, so `Migrate()` would try to create tables that are already there, and
baselining that is more machinery than one SQLite file on one machine has earned. `Schema.cs`
creates missing tables from **the model's own create script**, so it cannot drift from the
entity classes the way a hand-copied `CREATE TABLE` would. Its limit is stated in the file: it
adds tables, and will not add a column, drop one or change a type. The day one of those is
needed is the day §5's *"revisit when there are two of anything"* has actually arrived.

Two tests: one drops the table to age the database backwards and asserts the failure and then
the fix; one runs the step twice, because it runs on every startup and has to be idempotent
rather than merely harmless once.

### A dead control is worse than a failing one

The Everyone button was disabled when the fetch failed. That turned a transient failure into a
permanently dead control — nothing else retries, so once the server came back there was no way
to reach the shared map short of a reload. It stays enabled and clicking it retries, with the
reason in the note and in the title. **A failure that can fix itself needs an affordance that
can act on it.**

### Measured

```
POST publish          244 cells contributed, then +50 from a second run → 294
                      republish: identical 62 / 294, no churn
GET  /api/archive     78 kB for 244 cells — ~185 kB at a full grid
overlap               seed 777: 36 of 244    seed 31: 100 of 294
server killed         30 generations, 0 unhandled rejections, 1 amber dot,
                      toggle falls back to Mine and retries when clicked
tests                 255 Node, 30 .NET
golden                6.4598
```

### Done when

- [x] Publishing contributes elites; publishing again changes nothing and reports the same
      numbers.
- [x] `GET /api/archive` returns at most 576 cells however many runs are published.
- [x] The map toggles Mine / Everyone; Everyone outlines the cells your run also fills and says
      how many.
- [x] Clicking a community cell loads the gait, and names the body difference when there is one.
- [x] The C# insertion rule ties the same way `archiveInsert` does — mutation-tested, and only
      the SQLite test catches it.
- [x] The community repository has tests against real SQLite, not only against a fake.
- [x] With the server stopped: the local map works, no unhandled rejection, no `try`/`catch`
      outside `api.ts`. **Not** as specified — the toggle stays enabled and retries, because a
      disabled control could never re-enable itself.
- [x] The golden number is still 6.4598.

### Deliberately not in this slice

**No accounts and no attribution beyond a run title**, which goes in as a text node and an
attribute value, never as markup.

**No moderation, no rate limit, no deletion.** One SQLite file on one machine with one user. The
place to add them is `ContributeAsync`, and this note is the reminder.

**No live updates.** The map is fetched when Everyone is first selected and after publishing.
§10's amendment settles that polling is the answer if it is ever wanted.

**No cross-body normalisation.** Comparing stride length between robots of different leg lengths
is not meaningful, and a normalised axis would hide exactly the lesson the body warning teaches.

**Still no trajectory upload.** Carried over from slice 12: the endpoint and content-addressed
store exist and are tested, and nothing calls them.

---

## Slice 14 — Task suite

> **Status: built.** Three sessions. §6 of the design document, which is the most completely
> specified section in it and the one that has aged worst — **now amended**, the fifth such
> block, and the one that changed the most.

### Goal

Take a genome through a fixed set of tasks — rough ground, slopes, steps, a shove, extra mass —
and get a **scorecard** rather than a single number. §6's opening line is the whole argument:
*"Gaits evolved on flat ground are brittle in a way that is invisible until you test them."*

Everything the project has built so far scores a gait on 4 seconds of flat ground. This slice is
where that bill arrives, and the scorecard is expected to be humbling. That is the point.

### §6 says eight tasks. Seven of them are possible.

The 2D decision recorded in §4 and §9 reaches §6, and nobody noticed until now because §6 was
written when the physics was going to be three-dimensional.

| §6 task | Verdict |
|---|---|
| Sprint | Builds as written |
| Endurance | Builds, with the metric renamed — see below |
| Rough | Builds as written |
| Incline | Builds as written |
| Steps | Builds as written |
| **Slalom** | **Cut.** "Six waypoint gates", testing "steering, turn-in-place" |
| **Shove** | **Redefined.** "Lateral impulses" |
| Payload | Builds as written |

**Slalom cannot be built, and not because it is hard.** The simulation is sagittal: there is no
lateral axis for a gate to be beside, and the eleven-gene genome has no steering term, so nothing
in the search could learn to pass one. It would be a task every gait fails identically for a
reason that has nothing to do with the gait.

**Shove is redefined rather than cut**, because the *thing it tests* survives the projection even
though the axis does not. A fore/aft impulse to the torso tests recovery from a push, which is
what "closed-loop reflex quality" means, and it is a harder test in the sagittal plane than a
sideways one would be — the robot has to catch itself with the legs it actually has.

So: **seven tasks at this point in the slice, and six by the end of it** — running the terrain
is what took Rough as well. §6 is amended and its "Eight ways to fail" heading is tagged in
place rather than rewritten, the same treatment §10's superseded rows got.

### Three things in `packages/sim` assume the ground is a plane at y = 0

This is the actual work of the slice. Eight terrain generators is the part that sounds like the
work and is not.

1. **`fallen`** is `torsoHeight < 0.55 × standing height`, an *absolute* y. Twenty metres up an
   18° ramp raises the torso by 6.5 m, so a robot climbing perfectly would never be judged
   fallen and one descending a 12° ramp would be judged fallen immediately.
2. **Foot contact** is `lowestCorner(...) <= 0.005`, compared against zero. `evaluate.ts` already
   says so out loud: *"Revisit when the floor stops being flat."* This is that.
3. **`strideLength` and `dutyFactor`** are derived from contact, so they inherit the problem.

All three are the same fix: **terrain is a height function, and every one of these becomes
relative to the ground beneath the robot.** `groundHeightAt(x)`.

**One array, two consumers.** The heights that build the collider and the heights that answer
`groundHeightAt` must be the same `Float32Array` — if they ever disagree the robot floats or
sinks and nothing on screen explains why. The same rule as slice 10's *one time axis, one frame
index*, and it is worth a test that samples both.

Flat ground becomes `heights = [0, 0]`, so **the existing behaviour is a special case of the new
one**, and the acceptance test is that the golden number does not move. If 6.4598 changes, the
terrain layer has changed flat-ground physics and the slice is wrong.

### The suite re-runs the simulation, and that is not a contradiction

Slice 10's rule was that nothing in it re-runs the simulation, enforced by a test that scans
`render/gait/` for `evaluate(`. That rule was about *watching* a gait: a panel that simulates
makes looking at a gait cost as much as evolving one.

This slice is about *testing* a gait, and running new trials is the entire feature. Seven tasks
× five seeds is 35 trials per scorecard, and the rule that replaces slice 10's is that a
scorecard is **explicit and on demand** — a button, never a thing that happens because a panel
became visible.

**These trials never reach the archive.** The behaviour map is an observation of a search, and
the search runs on flat ground; folding in terrain trials would make coverage a claim about two
different worlds. Slice 8's rule, still holding.

### Cost of transport is not measurable, for the reason `effort` is not joules

§6 gives Endurance the primary metric "cost of transport". `TrialResult.effort` already records
why that number cannot exist here: Rapier's JavaScript binding exposes no joint impulses, so the
torque a motor actually applied cannot be read back.

So Endurance reports **joint travel per metre, radians/m** — the same ranking CoT would give for
a position-controlled robot, in units that are honest about what was measured. It must not be
labelled CoT anywhere, including in the mockups, which currently print `CoT 0.31`.

### Tasks are data. The metric is a named function, not an expression.

§6's decision line asks for "terrain generator, spawn, success predicate, **metric expression**",
loading as data so users can author tasks.

The first three are straightforwardly data. The fourth is not worth what it costs: Evolab has no
expression evaluator, and adding one — a parser, a sandbox, and a new class of runtime error —
so that a task can say `distance / time` instead of `metric: 'meanSpeed'` is a bad trade against
a lookup table with seven entries. **The metric is a key into a record of functions.** Everything
else §6 wanted from "declarative" survives: a user-authored task still picks its terrain, its
duration, its impulses, its mass change and its thresholds.

```ts
interface Task {
  readonly key: string;
  readonly name: string;
  /** What failing it tells you. Same job as the challenge cards' `teaches`. */
  readonly teaches: string;
  readonly terrain: TerrainSpec;      // flat | ramp | rough | steps
  readonly seconds: number;
  /** Payload: a multiplier on torso density, applied through `BipedSpec`. */
  readonly torsoDensity?: number;
  /** Shove: impulses at the torso, in newton-seconds, at a time in seconds. */
  readonly impulses?: readonly { readonly at: number; readonly x: number }[];
  readonly metric: MetricKey;
  readonly thresholds: { readonly bronze: number; readonly silver: number; readonly gold: number };
}
```

`TerrainSpec` → `Float32Array` of heights at a fixed spacing is one pure function, testable in
Node with no Rapier, like `bodies.ts`. **Sampled every 2 cm**: a 12 cm riser then occupies one
sample, which is an 80° face rather than a true vertical one. That is what "steps" means at this
fidelity and the note belongs next to the constant, not in a commit message.

### Session one, measured: the ground layer works, and it cut another task

> The sim half is built and the golden number is unchanged. Then the tasks were measured
> against five independently evolved gaits, and **Rough cannot be built either** — for a reason
> that has nothing to do with roughness.

**Every claim below is against five gaits evolved from different seeds** (45 generations, single
island), not against the reference champion. The first three attempts at this measurement used
one gait, and one gait cannot tell a brittle champion from a broken collider.

#### A segmented ground is not a floor

The first version built all terrain as a Rapier heightfield. A heightfield generates a contact
point per segment beneath a collider: **twenty of them under a 16 cm foot, against two for a
cuboid slab.** That over-constrained manifold is not a nuance.

```
                       mean distance over 5 gaits   fell
flat, one cuboid slab              2.84 m           1/5
flat, as a heightfield             0.64 m           5/5      <- identical geometry
```

Replacing the heightfield with a chain of rotated cuboids — two contact points each — changed
nothing (0.65–1.07 m at every spacing from 2 cm to 25 cm). So it is not the contact count, it is
**the seams**: a foot bridging two colliders gets two independent manifolds, and ghost
collisions at the internal edges cost more than any terrain does.

The fix for the terrain that *can* be expressed without seams is to stop sampling it:

- **flat** — the original slab, untouched
- **ramp** — one slab, rotated. Exact, and seamless along its whole length
- **steps** — one slab per tread. Real edges, four of them

Measured, a 0° ramp built as a rotated slab is indistinguishable from flat ground: **2.84 m
against 2.84 m.** That is the number that says the representation is faithful.

#### Rough is cut, and the evidence is that it has no signal

Rough is the one profile that cannot avoid seams, and with them its amplitude stops mattering:

```
rough, wavelength 2 m      0 cm   1.70 m      1 cm   1.14 m      3 cm   1.15 m
```

Against 3.80 m on flat ground for the same gaits. **The seams cost about 2 m and the roughness
costs about 0.5 m**, so the task would report the collider rather than the terrain. A task whose
own parameter barely moves its result is not a hard task, it is a broken one — the rule the
thresholds section already states, arriving earlier than expected.

So the suite is **six tasks**: Sprint, Endurance, Incline, Steps, Shove, Payload. §6 said eight,
the sagittal plane took Slalom, and the contact solver took Rough.

#### What the surviving tasks actually discriminate

```
                       flat 3.80 m baseline, 5 gaits
Incline    +2°  1.77    +4°  0.60    +8° −0.22    −3°  1.09     clean gradient
Payload   +10%  3.58   +25%  1.49   +50%  1.23                  clean gradient
Shove      +20  2.10    +40  2.13    +80  2.18                  saturates
           −40  0.89                                            discriminates
Steps    4×2cm  2.26  4×6cm  2.15                               weak
```

**Incline and Payload are the good tasks.** Shove only discriminates backwards — any forward
impulse large enough to matter causes a fall, so magnitude stops mattering; the task uses
retarding impulses. **Steps is weak**: most of its cost is its four seams rather than its rise,
which is the Rough problem in miniature and the reason it survives only because four seams are
countable and 3,200 are not.

#### The offset that moved the golden number

Restructuring the ground builder moved the −0.5 m offset from the rigid body onto the collider.
Geometrically identical; numerically not — **6.4598 became 5.8015**. It takes a different
floating-point path through the solver.

Flat ground is therefore built exactly as it always was, as an early return above the terrain
switch, with the reason written next to it. The lesson generalises past this project: *when a
golden number exists, "geometrically identical" is not a safe refactor of physics setup.*

### Session two: six tasks, calibrated, and `npm run tasks`

`packages/evolution/tasks.ts` holds the suite as data and the scorecard as arithmetic; nothing
in it simulates anything. `npm run tasks` is the counterpart to `npm run evolve` — that one
prints what the search found, this one prints what it is worth.

**`terrain.ts` moved from `packages/sim` to `packages/evolution`.** `tasks.ts` has to name a
terrain, and invariant 3 forbids the search importing the simulator. Terrain is pure arithmetic
with no Rapier, so it belongs on the evolution side by the same precedent `buildBiped` sets: a
pure description of a physical thing lives with the search, and the simulator consumes it.

#### Thresholds, calibrated against five gaits

Slice 8's lesson, applied on purpose this time. `npm run tasks -- --calibrate` runs the suite
against five gaits evolved from different seeds and prints the medians; the thresholds come from
that distribution — bronze near the median gait, gold near the best.

```
task       unit           g0       g1       g2       g3       g4     median
Sprint     m/s          1.72     0.21     0.38     1.06     0.38       0.38
Endurance  rad/m       -6.53  -118.37   -13.35   -11.37   -19.50     -13.35
Incline    m            5.18    -0.16     0.70    -0.09     0.37       0.37
Steps      m            2.57     0.61     1.47     1.32     1.53       1.47
Shove      m            5.68     0.04    -0.15     1.32    -0.81       0.04
Payload    m            4.51     1.80     1.25     0.61     1.15       1.25
```

**Two tasks were re-tuned by this table, not by taste.** Incline started at §6's steeper end and
four of five gaits went nowhere; at 2° the median is 0.37 m and the spread is real. Shove started
at −40 N·s with the same problem and now uses −25.

#### Falling caps a badge at bronze

The rule earned itself inside a minute. The reference champion covers 2.37 m on Steps before
going down, which cleared gold, and the first scorecard printed **`5/5 fell` and `GOLD` on the
same line**. A distance reached by toppling forwards is a real distance and worth some credit,
but it is not a gait that clears the steps — §6 says so itself: *"a gait that clears the steps
once in five is a gait that does not clear the steps."*

A majority rather than all five, so one unlucky seed does not erase a badge and three do.

#### The champion, tested

```
task        median    spread            fell   badge
Sprint       1.49 m/s        1.46–1.49    0/5   SILVER
Endurance  -7.22 rad/m      -7.24–-7.20    0/5   GOLD
Incline        5.15 m        5.15–5.21    0/5   GOLD
Steps          2.37 m        2.24–2.40    5/5   BRONZE
Shove          4.90 m        4.88–4.95    0/5   GOLD
Payload        5.69 m        5.66–5.75    0/5   GOLD
overall    6/6 passed                         BRONZE

6 tasks × 5 seeds in 0.60 s
```

**The gait that scores 6.4598 on flat ground is a bronze robot once it is tested**, and it is
Steps that says so — the one task where it falls every time. That single line is the thesis of
§6 delivered without a word of explanation, which is what the suite was for.

Sprint missing gold by 0.01 m/s is a coincidence and a good advertisement for the composite
rule: the overall badge is the worst task, so nothing is bought with speed.

### Session three: the panel, and one worker more

The scorecard sits under the behaviour map in the right column: six rows, a badge each, a
composite in the panel header, and one line of prose under it.

**Explicit and on demand.** Slice 10 forbade its panels from re-running the simulation, and a
test scans `render/gait/` to enforce it — a panel that simulates makes *looking* at a gait cost
as much as evolving one. This slice exists to run trials, so the rule that replaces it is the
button: a scorecard happens because somebody asked for it, never because a panel became visible.

**A second instance of `island.worker.ts`, not a second worker file.** Vite bundles a worker per
entry and `-compat` inlines Rapier's WASM into each one — Appendix A measured that at about
1.5 MB. A separate entry would have added a third copy to the download to avoid one `case` in a
`switch`. Another instance of the same file costs a second WASM instantiation in memory and
nothing on the wire; the network panel shows all five workers requesting one URL.

Its own worker rather than an island's for two reasons. The suite takes about half a second, and
an island answering it would stall its own search for that long — but the load-bearing one is
that **the pool is built lazily**, so a scorecard has to work before anything has been evolved.
Verified: on a fresh page with no run at all, the default slider gait scores `fail 0/6` in
0.24 s, which is both the right answer and the right moment to be told it.

**A card must not outlive the gait it describes.** The body and the sliders are both editable
while a scorecard is on screen, and a card beside a changed robot is a claim about something
that no longer exists. A cheap signature — eleven genes plus the body's own numbers, summed once
a frame — drops it and says so.

**`runSuite` takes an evaluator**, exactly as `evolve(island, evaluate)` does, because invariant
3 forbids `packages/evolution` importing the simulator. That is what stops the CLI and the
browser running two copies of the suite that quietly drift; both call the same function and pass
`evaluateGait`.

#### The specificity trap, a third time

The composite badge in the panel header came out grey. `.ph em` is more specific than
`.bg-bronze`, so a `color` declared on the palette class loses — the same shape as `#archive`
beating `.explorer-only` in slice 8 and `.gait.on` losing to its own media query in slice 10.

Fixed by carrying the palette as **custom properties** rather than as colour declarations: the
palette class only defines `--badge` and `--badge-bg`, and each consumer applies them at
whatever specificity it needs. That is the general answer to this trap rather than a third
one-off, and it is why the row badge and the header badge can share one palette at all.

#### In the browser

```
Sprint      1.58 m/s              GOLD
Endurance   6.36 rad/m            GOLD
Incline     4.75 m    fell 2/5    GOLD
Steps       2.71 m    fell 5/5    BRONZE
Shove       1.97 m    fell 5/5    BRONZE
Payload     4.80 m    fell 3/5    BRONZE

bronze · 6/6 — 6 tasks × 5 seeds in 0.43 s
```

*"bronze overall, because it falls on Steps in 5 of 5 runs. The badge is the worst task, not the
average — speed cannot buy it."* Naming the task holding the composite down is the actionable
half of §6's rule: a reader told "bronze" learns nothing, and one told *why* knows what to fix.

### Five seeds, a median, and a spread — and a budget

§6: *"a gait that clears the steps once in five is a gait that does not clear the steps."* Fixed,
stated seeds, so two scorecards are comparable.

35 trials is cheap only if the durations are. Endurance as written is "200 m flat, no limit",
which at ~1 m/s is 200 s of simulated time — 48,000 steps × 5 seeds, and at the measured ~84,000
steps/s that is fourteen seconds for one task. **Every task gets a fixed seconds budget** and
Endurance measures travel per metre over a bounded run rather than an unbounded one.

Target: **the whole scorecard in under 5 seconds.** State the measured number when it exists.

It runs in **the existing island worker, behind one new message type**, not a worker of its own.
Appendix A measured the cost of a second Rapier context at ~1.5 MB of inlined WASM per bundle,
and a third one to avoid a `switch` is the wrong trade. The consequence — a scorecard needs a
pool, and a pool is built lazily — is the thing to check early.

### Thresholds are calibrated, not guessed

Slice 8 set both archive axis ranges from the textbook and both were wrong; running it is what
showed it. The same trap is open here and it is worse, because a scorecard that reads FAIL seven
times teaches nothing at all.

So the thresholds in `tasks.ts` ship as **placeholders**, and the first job after the suite runs
is to put the reference champion (seed 4417, 30 generations, 5.96 m) and two or three archive
elites through it and set bronze at roughly what they achieve. The numbers go in the notes with
the gaits that produced them. **A task no gait can pass is a broken task, not a hard one.**

The composite badge keeps §6's good rule: a minimum in *every* task, so a sprint specialist
cannot buy a gold with speed alone.

### Shape of the work

**`packages/sim`.** `terrain.ts` — `TerrainSpec` → heights, pure, no Rapier. `world.ts` takes a
terrain and builds a heightfield collider; `groundHeightAt(x)` reads the same array. `fallen` and
the contact test become ground-relative. `Sim.applyImpulse`.

**`packages/evolution`.** `tasks.ts` — the seven task definitions as data, the metric functions,
and `scorecard(results)` folding trials into badges. Pure, so the whole thing tests in Node.

**`apps/web`.** One new worker message; a scorecard panel with a Run button; seven rows and a
composite badge.

### Done when

- [x] The golden number is still 6.4598 — flat ground keeps the exact collider it always had,
      which turned out to matter: moving the same offset from the body to the collider is
      geometrically identical and moved it to 5.8015.
- [x] The collider and the height function agree. Ramp and steps are **exact** rather than
      sampled — one rotated slab and one slab per tread — so the question does not arise for
      them; `terrain.test.ts` pins the profiles and a 0° ramp against flat.
- [x] A robot climbs and descends without the fall test firing on the slope rather than on the
      robot. `fallen` is height above the ground beneath the torso.
- [x] **Six** tasks × five seeds produce a scorecard with a median and a spread per task.
      Seven was still one too many; Rough went the same way as Slalom, for a different reason.
- [x] Thresholds are calibrated against five gaits, and the table they came from is above.
- [x] 0.60 s headless, 0.43 s in the browser, in a worker of its own — never on the main thread.
- [x] Terrain trials do not reach the behaviour archive: the suite calls `evaluateGait` directly
      and no archive is involved anywhere in it.
- [x] §6 is amended — six tasks, Slalom cut, Rough cut, Shove redefined, CoT renamed, and the
      metric-expression decision reduced to the three parts of it that survive.

### Deliberately not in this slice

**No Slalom, and no steering.** Cut for the reason §4 gives, not deferred.

**No user-authored tasks.** They load as data, which is the precondition; a UI for writing them
is a different slice and §6 said v1.1 itself.

**No export.** Fig 9.7 has an "Export scorecard" button. A run already round-trips through the
server; a second serialisation format needs a reason.

**No re-evolution against tasks.** Scoring the search on the suite is multi-objective evolution,
which §14 defers out of v1 entirely, and it would make the archive descriptors meaningless.

### Two stale references to fix in passing

`CONTACT_EPSILON` in `evaluate.ts` says the floor stays flat "until the challenge track in slice
14" — the challenge track was slice 11, and slice 14 is this. And the §6 mockups print `CoT
0.31`, which is a number this project cannot measure.

---

## Slice 15 — Help

> **Status: built.** One session. Not on the original list — asked for after slice 14, and
> squarely inside the project's own first line: *teaching tool first, simulator second.*

### Goal

A reference you can read start to finish, written for somebody who has never seen a genetic
algorithm and has just opened the app. `?` or the toolbar button, full screen like the stepper.

Everything the app had until now was **contextual**: guided afterwords, challenge cards, panel
notes, task `teaches` lines. All of it answers a question you already knew to ask. None of it
answers *what am I looking at*.

### The rule: help does not restate what the app already knows

A help section is a second description of the product, and second descriptions rot. This one is
mostly generated:

| section | source |
|---|---|
| The ideas behind it | `NOTES` — the twelve concept notes, verbatim |
| What you are asking for | `PRESETS` — goal names and blurbs |
| The scorecard | `TASKS` — each task's own `teaches` line |
| Keyboard | `LISTED_SHORTCUTS` |

Four tests assert **identity, not similarity** — `conceptRows()` must equal `NOTES`, not merely
have the same length. A paraphrase would be exactly the drift the arrangement exists to prevent.

What is left is prose that exists nowhere else: what the thing is, a five-step first run, what
each panel is, and a glossary of every number on screen. The one part of *that* which can rot is
the elements it names, so each panel row carries the id it describes and a test reads
`index.html` and asserts every one is really there.

### The keymap became data, and it had been three descriptions

The shortcuts lived in a ladder of `if`s in `main.ts`, with a hardcoded hint strip in the
toolbar listing five of them, and help would have been a third copy. `ui/keymap.ts` is now the
only description: the handler dispatches from it, the hint strip is generated from it, and help
renders it. A key cannot be documented without existing or exist without being documented.

Writing the test caught the first casualty immediately — `?` was documented as *"Open this
help."*, fifteen characters, against a rule that every shortcut gets a sentence a beginner could
act on. The fix was to write a better sentence, not to lower the threshold.

### Two bugs, one of them older than the slice

**Markdown emphasis rendered literally.** The copy used `*you*` and `*kind*` for contrast, and
it goes through `textContent`, so readers saw the asterisks. The contrast carries meaning in
those sentences, so rather than flatten the writing there is now a one-rule renderer: `*…*` →
`<em>`, building text nodes and never touching `innerHTML`. `emphasisParts` is split out so the
parsing tests in Node without a DOM, and one test walks **every string in the help copy** and
asserts no marker survives rendering — which is the guard that would have caught it.

**Full-screen overlays sat below the drawers.** `.stepper` was `z-index: 20`; the narrow-width
side drawers are `30`. So below 1000 px an open drawer rendered *on top of* the help text — and
on top of the stepper, which has had the bug since the drawers arrived in slice 11. Found at
560 px. Anything covering the whole app has to outrank anything covering part of it.

### The `?` on each panel header

Seven of them, and each opens help **at that panel's paragraph** rather than at the top of a
section the reader then has to search. `panelAnchor(id)` is the one rule, used by the renderer
that stamps the anchor and by the button that jumps to it.

Two things fell out of wiring it:

**The gait controls had no header at all** — the busiest column in the app began with an
unlabelled row of sliders, and the panel a beginner most needs help with had nowhere to put a
`?`. It has one now.

**`open()` prefixed `hp-` itself**, and `panelAnchor` already included it, so every panel button
looked for `#hp-hp-panel-chart`, matched nothing, and **silently fell back to the top of the
document** — the failure mode that looks like a design decision. It takes the whole element id
now, and the contents links pass theirs.

Attachment happens last in `boot()`, because four panels build their own header, and a header
that cannot be found is reported to the console rather than skipped: a `?` that quietly stops
appearing is worse than one that never did. A test pairs every declared header with a panel help
really describes, and asserts each id appears in the source — in markup or as a property
assignment, since both idioms are used.

**Panel headers no longer wrap.** They are a fixed 28 px bar and the title is a bare text node,
so in the 236 px left column it wrapped to two lines — which the bar did not clip but did make
look broken. `white-space: nowrap`, and the subtitle gives way with an ellipsis.
### Deliberately not in this slice

**No tour, no tooltips, no pointer hijacking.** §7 is explicit that the temptation with an
educational build is to wrap the real application in a layer of explanation and call it taught.
Help is a place you go, deliberately, and it does not follow you out.

**No search.** Eight sections with a contents list down the side; a search box over 43 paragraphs
is machinery, not navigation.

**No screenshots or diagrams.** They are the first thing to go stale, and this app can show the
reader the real panel in one click instead.

### Done when

- [x] `?`, the toolbar button and the ⋯ menu all open it; `Escape` and Close close it.
- [x] Other shortcuts are inert while it is open — verified by firing `R` and watching the
      generation counter not move.
- [x] Nothing in it is retyped from data the app already holds, and four tests assert identity.
- [x] Every element it names exists in `index.html`, checked by reading the file.
- [x] It reads single-column below 720 px with no horizontal scroll, and covers the drawers.
- [x] Each panel header carries a `?` that opens help at its own paragraph — seven of them,
      verified in the browser landing on the right heading each time.
- [x] 314 tests, golden 6.4598 unchanged.

---

## Appendix A — Rapier notes

Accumulated API facts. Add to this whenever something surprises you.

**Initialisation.** `await RAPIER.init()` once per *context* — main thread and every worker
separately. WASM memory is not shared across workers.

**Memory.** `World.free()` is mandatory. Rapier objects live in WASM linear memory and are
not garbage collected. Anything that creates a world in a loop must dispose it in a
`finally`.

**Cuboids take half-extents.** `ColliderDesc.cuboid(hx, hy)` describes a box `2hx × 2hy`.

**Collision groups** pack membership into the high 16 bits and the filter mask into the low
16: `(membership << 16) | filter`. Two colliders interact only if each one's membership
intersects the other's filter.

**Joint anchors are in local frames.** A revolute joint is created with
`RAPIER.JointData.revolute(anchorInParent, anchorInChild)`; both anchors describe the same
world point when the bodies are in their rest pose.

**Limits** are set on the `JointData` before creation: `params.limitsEnabled = true;
params.limits = [min, max]` in radians.

**Rotation in 2D is a scalar** — `body.rotation()` returns radians, not a quaternion. In 3D
it returns a quaternion, which slice 9 will have to account for.

**`-compat` builds** inline the WASM as base64. Larger download, but no separate `.wasm`
asset to configure in the bundler and no worker-loading edge cases.

Slice 4 put a number on that trade. Workers get their own bundle, and since each context
needs its own Rapier instance, the WASM is inlined *twice*:

```
dist/assets/island.worker-*.js   1,552 kB
dist/assets/index-*.js           1,566 kB   (gzip 586 kB)
```

Around 3 MB raw for what is essentially one physics engine counted twice. Acceptable for
now and the reason to revisit `-compat` later: a separate `.wasm` asset would be fetched
once and shared by the browser cache across both contexts. Not worth doing until bundle
size actually bites.

---

## Appendix B — Genome layouts

### Parametric, mirrored (slices 2–6)

`n = 11`. Genes are in `[0, 1]` and decode linearly into these ranges. The order matches
the URL encoding in the slider panel, so a gait found by hand and a gait found by evolution
are the same eleven numbers in the same order.

| Index | Parameter | Range |
|---|---|---|
| 0 | gait frequency | 0.5 … 3.0 Hz |
| 1 | balance gain | −2 … 2 |
| 2 | hip amplitude | 0 … 0.8 rad |
| 3 | hip phase | 0 … 2π |
| 4 | hip centre | −0.5 … 0.5 rad |
| 5 | knee amplitude | 0 … 0.9 rad |
| 6 | knee phase | 0 … 2π |
| 7 | knee centre | −0.8 … 0.1 rad |
| 8 | ankle amplitude | 0 … 0.5 rad |
| 9 | ankle phase | 0 … 2π |
| 10 | ankle centre | −0.4 … 0.4 rad |

Left and right joints share parameters; the right side adds π to phase.

### Parametric, independent — planned for slice 7, **not adopted**

> **This section describes a layout that was never built, and it read as fact until the
> slice 11 concept audit went looking for a way to teach asymmetry.**
>
> Slice 7 kept the genome at **eleven mirrored genes** on purpose. `gaitTargets` reads
> `params[joint.kind]`, so both legs share one amplitude, phase and centre and differ only by
> a half-cycle offset in `SIDE_PHASE`. That is what lets an evolved gait be dropped onto a
> different set of legs — the single most instructive thing in the body editor — and it is
> worth more than asymmetry.
>
> The consequence: **this robot cannot limp.** §7's *symmetry* concept is not unimplemented,
> it is unrepresentable, and the concept ladder should say so. The rest of this section is
> kept as the design that was considered, in case a lateral or asymmetric term is ever worth
> the transferability it would cost.

Once the body is user-editable, genome length is computed from the morphology rather than
fixed:

```
n = 1 + 3 · J          mirrored   (one triple per distinct joint type)
n = 1 + 3 · J_total    independent (one triple per actuated joint)
```

For the default biped, `J = 3` distinct types and `J_total = 6`, giving `n = 11` mirrored
or `n = 20` independent (the extra gene in each case is the balance gain). Mirroring becomes a per-run option rather than a constant, because
an asymmetric gait is something worth discovering rather than ruling out. Genome length
depends on joint count, so genomes do not transfer between morphologies — the UI must say
so rather than silently producing nonsense.

### Later encodings

CPG (`9J + 4`) and neural (`~1.4k`) are specified in §3 of the design document. Neither is
in the v1 build; the parametric encoding is the default throughout because every gene maps
to a visible feature of a curve, which is what makes the stepper worth looking at.
