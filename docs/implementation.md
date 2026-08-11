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
| 8 | [Behaviour archive](#slice-8--behaviour-archive) | 2 | next |
| 9 | 3D replay | 3 | sketch |
| 10 | Gait analysis | 2 | sketch |
| 11 | Challenge track | 3 | sketch |
| 12 | The server | 3 | sketch |
| 13 | Community archive | 2 | sketch |
| 14 | Task suite | 3 | sketch |

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

> **Status: next.** Two or three sessions. The largest single slice in the project, and the
> first one that can make everything before it slower without making anything better.

### Goal

Watch the champion walk in a 3D scene with an orbit camera and a timeline scrubber, while
the 2D view stays exactly as it is. §9 of the design document.

### Depends on

Everything. The archive is the last slice that changes how the search works; this one only
changes how it is watched.

### The decision to make first: does the physics move to 3D?

Two honest options, and the answer is not obvious.

**A — render 3D, simulate 2D.** The sagittal simulation stays as it is; the renderer extrudes
each segment into a box and mirrors the far leg properly instead of nudging it sideways with
`FAR_LEG_RENDER_OFFSET`. Cheap, keeps every number in the project valid, keeps the golden
test meaningful, and ships in one session. The robot cannot fall sideways, ever, and a viewer
who orbits to the front will see that immediately.

**B — move to `rapier3d`.** The morphology gains a third dimension and roll joints, and the
biped can now fall sideways — which is realistic and which the eleven-gene sagittal genome
has no way to correct. Every fitness number in the project is invalidated. The golden test
has to be re-pinned. It is a slice and a half of work before anything walks again.

**Take A, and say so in the UI.** The teaching claim this project makes is about evolution,
not about robotics fidelity, and B spends its entire budget buying a failure mode the
controller cannot address. B is worth revisiting only if the genome grows a lateral term,
which is slice 14 territory at the earliest. Write the reasoning into §9 as an amendment the
way slice 7 amended §12 about React, because "why is it flat?" is the first question any
reader will ask.

### Design

Three.js, loaded **only when the 3D tab is first opened**. It is roughly 600 kB and the
guided flow never needs it; a dynamic `import()` keeps it out of the first paint. That is
also the test of whether the render layer is properly separated — if `render/three/` cannot
be code-split out, something below `apps/web` has reached up into it.

```
apps/web/src/render/three/
  scene.ts      lights, ground grid, camera rig — built once, reused across replays
  bodies.ts     Snapshot → instanced boxes; one InstancedMesh, not N meshes
  controls.ts   orbit + the scrubber
```

`Snapshot` already carries everything needed: id, x, y, angle, halfWidth, halfHeight, layer.
The third dimension is a constant per `layer` — near leg at z = +0.09, far leg at z = −0.09,
torso at 0 — so `bodies.ts` is a pure function from a snapshot to instance matrices and can
be tested in Node without a canvas.

**The scrubber needs recorded frames, which do not exist yet.** `evaluate` currently returns
numbers and throws the trajectory away. Add an opt-in:

```ts
evaluate(morph, genome, { seed, seconds, record: true })   // → TrialResult & { frames }
```

recording one `Float32Array` per body per control tick (60 Hz, not 240 — four times fewer
frames and nothing visible is lost). A 4-second trial is 240 frames × 7 bodies × 3 floats ≈
20 kB, which is nothing. It must stay **off by default**: the inner loop runs tens of
thousands of times per study and must not allocate.

Slice 10's footfall diagram and joint-angle traces read the same recording, so the format is
worth getting right here.

### Watch for

- **The replay loop is already fixed-timestep.** The 3D view renders whatever the accumulator
  has stepped to; it does not get its own clock. Invariant 1 is not negotiable because
  something has an orbit camera now.
- **`FAR_LEG_RENDER_OFFSET` is 2D-only.** In 3D the legs are genuinely separated, so the fudge
  must not be applied — and the convention note in `CLAUDE.md` about zeroing it when checking
  a screen position against a world coordinate needs updating to say which renderer it means.
- **One `InstancedMesh`.** Seven boxes per robot is nothing, but ghost overlays in slice 10
  multiply that by however many ghosts, and retrofitting instancing later is worse than
  starting with it.
- **Dispose geometries and materials** when the tab closes. Three.js leaks GPU memory exactly
  as enthusiastically as Rapier leaks WASM memory, and the lesson from `sim.dispose()` applies
  unchanged.

### Done when

- [ ] A 3D tab shows the champion walking, orbitable, with a ground plane and a grid.
- [ ] Three.js is dynamically imported and absent from the initial bundle.
- [ ] The 2D view is untouched and remains the default.
- [ ] A scrubber seeks to any frame of a recorded trial and the 3D and 2D views agree on it.
- [ ] `record: true` produces frames; `record` unset allocates nothing extra — asserted by a
      test that counts allocations or, failing that, by a trials/s benchmark that has not moved.
- [ ] `npm test` still passes and the golden number is still 6.4598, because none of this
      touches the search.

### Deliberately not in this slice

No 3D physics — see above, and write the reasoning down where a reader will find it.

No ghost overlays, no footfall diagram, no joint traces. Those are slice 10 and they all
read the recording this slice defines; building the recording well is this slice's real
contribution.

No mesh import, no textures, no shadows beyond a single directional light. A grey box robot
on a grid reads better for teaching than a styled one, and every hour spent on materials is
an hour not spent on slice 10.

---

## Slices 10–14 — Later stages

Sketches only. Each will be written out fully at the end of the slice before it.

| # | Name | Shape of the work |
|---|---|---|
| 10 | **Gait analysis** | Footfall diagram, joint-angle traces, hip phase portrait. All share one scrubber with the replay. Slice 8 already detects foot contact and slice 9 already records frames; this slice draws them. |
| 11 | **Challenge track** | Twelve challenges as JSON data, per-concept progress, the deliberately-naïve fitness challenge from §7 of the design document. Task definitions load as data, not code. |
| 12 | **The server** | One ASP.NET Core project: EF Core, SQLite, static hosting of the built SPA, about ten endpoints. See §5 of the design document. Nothing before this slice needs .NET installed. |
| 13 | **Community archive** | Publish elites; merged grid across all published runs. `archiveMerge` already does exactly this for the four islands — the only new part is that the maps arrive over HTTP rather than over `postMessage`. |
| 14 | **Task suite** | Eight terrain generators and a scorecard. Mostly a lot of small, independent work — good for short sessions. |

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

### Parametric, independent (slice 7+)

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
