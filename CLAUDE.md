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

**Slice 4 — "Off the main thread".** The search runs in Web Workers, one island each,
trading two elites round a ring every five generations. The UI thread does no physics at
all beyond the champion replay. Measured 88 trials/s on one worker and 329 on four —
**3.7× on four cores** — and a 40-generation run finishes in about 11 seconds.

```bash
npm run dev                                     # the app; ?workers=1 to compare
npm run evolve                                  # headless, single island, 30 gens, ~9 s
npm run evolve -- --gens 120 --seconds 8        # the long one, ~70 s, reaches 17.7 m
```

Two things about workers that are easy to misread:

- **Islands multiply population, not generation rate.** Generations per second barely
  changes; what four workers buy is four populations searching at once. Nothing makes a
  single island reach generation 400 faster — a generation is sequential.
- **Multi-worker runs are not bit-reproducible.** Migration is asynchronous, so a migrant
  landing before generation 7 rather than after changes everything downstream. One worker
  *is* bit-reproducible, and the CLI, `npm run sim` and the golden test all run
  single-island, so every guarantee the project makes still holds.

Before touching the physics, read
[the motor stiffness trap](docs/implementation.md#the-motor-stiffness-trap). A whole
session went into diagnosing "this biped cannot balance open-loop, that is a fundamental
limit" when the actual cause was motor gains being 200× too small. The lesson recorded
there is worth more than the fix.

Next: slice 5 — the generation stepper, the teaching screen. Specified in
[docs/implementation.md](docs/implementation.md#slice-5--the-stepper). Note its key idea:
convert `stepGeneration` into a generator that yields at each operator boundary, so normal
running and single-stepping drive the same code rather than two implementations. That
conversion must leave the golden test passing untouched — if it does not, the order of RNG
draws moved.

Two rules the GA earned the hard way, both written up in the slice 2 section:

- **If a score survives across generations, the conditions it was scored under must not
  change.** Elites are not re-evaluated, so a per-generation trial seed let a lucky genome
  keep a stale high fitness. `IslandConfig.trialSeed` is fixed for a whole run.
- **A champion is tuned to the one perturbation it was scored on.** `npm run evolve`
  re-tests it on five unseen tilts and prints the spread, because a gait that only works
  once is not a gait.

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
6. **Tests are never deleted or loosened to make a change pass.** If one fails, either the
   change is wrong or the change is deliberate — say which, in the commit message, and
   update the expected values in the same commit.

   Three of them are regression guards for bugs that actually shipped, and each has been
   verified to fail when its bug is reintroduced: `weighs about 21 kg` (density is per
   *area* in 2D), `joint limits are actually enforced` (`setLimits` on the joint, not on
   the `JointData`), and the `motor authority` block (gains 200× too low). Do not relax
   these; they are the cheapest insurance in the project.

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
npm test             # unit tests — run these before every commit
npm run check        # typecheck everything
npm run sim          # headless: step the biped in Node, print positions
```

`npm test` is 53 tests in about 1.5 s, so there is no excuse for not running it. It covers
the RNG (including a pinned golden vector), the controller, the morphology, and the
physics — the last of these builds real Rapier worlds and is still fast enough to sit in
the inner loop.

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
