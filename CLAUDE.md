# Evolab

A browser app for designing bipedal robots, evolving their walking gaits with a genetic
algorithm, and learning how both work by watching them happen. Personal project, built in
slices. Teaching tool first, simulator second.

Two documents, different jobs:

- **[docs/technical-design.html](docs/technical-design.html)** — the architecture and UI
  specification. Open it in a browser. 16 sections, 16 figures, every architectural
  decision and *why* it was made. Stable; changes only when a decision changes.
- **[docs/implementation.md](docs/implementation.md)** — *how* each slice is built, and in
  what order. Data structures, algorithms, formulas, acceptance criteria. A living
  document: **updating it is part of finishing a slice.**

When this file and the design document disagree, the design document wins. When the
implementation guide and the code disagree, the code wins and the guide is stale — fix it.

## Current state

**Slice 0 — "It falls over".** A jointed 2D biped ragdolls onto a floor under Rapier
physics, rendered to a canvas. No controller, no GA, no UI. That is the whole point of
slice 0: prove the physics and the render loop, nothing else.

Next: slice 1 — a sinusoid controller with sliders, to discover by hand how bad
hand-tuning is. It is specified in full in
[docs/implementation.md](docs/implementation.md#slice-1--it-walks-badly): controller
formula, parameter ranges, the Rapier motor API to reach for, and what "done" means.

Before starting a slice, read its section. After finishing one, rewrite that section to
describe what was actually built and expand the next one.

## Invariants

These are the rules that must survive between sessions. Breaking one is a bug even when
the app still works.

1. **Fixed timestep.** Physics steps at exactly `1/240 s`. The render loop accumulates
   real time and steps a whole number of times. Never step by frame delta.
2. **Seeded RNG only.** No `Math.random()` anywhere in `packages/`. Randomness comes from
   an `Rng` instance threaded through explicitly as a parameter. This is what makes runs
   reproducible and the golden test possible.
3. **`packages/evolution` stays pure.** No DOM, no `window`, no timers, no Rapier import,
   no I/O. It must run under Node in a test. If it needs to simulate, it takes an
   evaluator function as an argument.
4. **`packages/sim` owns Rapier and nothing else.** It builds a world from a morphology,
   steps it, and returns numbers. It does not render, and it does not know what a genome is.
5. **Nothing browser-specific below `apps/web`.** Workers, canvas, React, storage — all
   live in the app, never in a package.
6. **The golden test is never deleted or loosened to make a change pass.** (Arrives in
   slice 2, with the GA.) If it fails, either the change is wrong or the change is
   deliberate — say which, in the commit message.

## Layout

```
packages/evolution/   pure TS — rng, types; later: GA operators, fitness, archive
packages/sim/         Rapier wrapper — morphology → world, step, record
apps/web/             Vite app — canvas render, later React panels and workers
docs/                 the technical design document
```

Packages are consumed as source via Vite aliases (`@evolab/evolution`, `@evolab/sim`).
There is no build step for packages and there should not be one.

## Commands

```bash
npm install          # once, from the repo root
npm run dev          # http://localhost:5173
npm run check        # typecheck everything
npm run sim          # headless: step the biped in Node, print positions
```

`npm run sim` exists because invariants 3 and 4 make it possible, and because verifying
physics without a browser is much faster than verifying it with one. It also asserts that
the same seed replays identically — the first, smallest form of the golden test.

The dev page takes `?seed=42` and `?paused=1`, so a specific fall can be reproduced and
stepped through frame by frame. In the page: `R` respawn, `Space` pause, `.` single step.

### Node runs TypeScript directly

`npm run sim` uses `node --experimental-strip-types`, which **erases** types rather than
compiling them. Syntax that emits code is therefore rejected. In practice that means:
no parameter properties (`constructor(private x: number)`), no `enum`, no namespaces, and
no decorators. Use explicit fields, `const` objects with `as const`, and plain modules.
Keeping every file strip-compatible is what avoids a build step for tests and scripts.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on. The compiler is the code reviewer.
- Units are SI throughout: metres, kilograms, seconds, radians. Screen pixels appear only
  in `apps/web/src/render/`.
- World coordinates are y-up. Canvas is y-down. The flip happens in exactly one place
  (`render/camera.ts`) and nowhere else.
- The renderer nudges the far leg sideways (`FAR_LEG_RENDER_OFFSET` in `render/draw.ts`)
  because a strictly sagittal biped's legs overlap exactly at rest and it looks like a
  pogo stick. That offset is the only place the drawing disagrees with the simulation.
  Zero it when checking a screen position against a world coordinate.
- Prefer plain functions and plain objects. No classes unless there is state with a
  lifecycle (`Rng` is the current exception).
- Commit per slice. Put the observable result in the message — "biped falls over in 1.2 s",
  later a golden fitness number.

## Things not to do

- Do not tune physics parameters to make the walk look better. Evolution compensates for a
  mediocre model far better than hand-tuning does, and a weekend disappears into friction
  coefficients with nothing to show. Ship the numbers in the design doc until the GA runs.
- Do not add Three.js or any 3D before slice 9. Debugging evolution through a 3D view is
  much harder than through a 2D one.
- Do not start the .NET server before slice 12. It is the familiar, comfortable part and it
  serves a client that does not exist yet. The design doc says this out loud in §5 for a
  reason.
- Do not "tidy up" working simulation code without the golden test passing before and after.
