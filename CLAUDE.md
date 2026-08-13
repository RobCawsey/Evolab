# Evolab

A browser app for designing bipedal robots, evolving their walking gaits with a genetic
algorithm, and learning how both work by watching them happen. Personal project, built in
slices. Teaching tool first, simulator second.

Three documents, different jobs:

- **[docs/code-design.html](docs/code-design.html)** — how the *code* is organised, for a
  reader who has never seen the project. Layers and dependency direction, the nine core types,
  module by module, the repeating patterns, and how the tests are designed. Ten diagrams.
- **[docs/technical-design.html](docs/technical-design.html)** — the architecture and UI
  specification. Open it in a browser. 16 sections, 16 figures, every architectural
  decision and *why* it was made. Stable; changes only when a decision changes.
- **[docs/implementation.md](docs/implementation.md)** — *how* each slice is built, and in
  what order. Data structures, algorithms, formulas, acceptance criteria. A living
  document: **updating it is part of finishing a slice.**

When this file and the design document disagree, the design document wins. When the
implementation guide and the code disagree, the code wins and the guide is stale — fix it.

## Current state

**Slice 15 — "Help".** A full-screen reference at `?` or the toolbar button, written for
somebody who has never seen a genetic algorithm: what this is, a five-step first run, what every
panel is, a glossary of every number on screen, the twelve ideas, and the keyboard. Not on the
original list — asked for after slice 14, and squarely inside the project's own first line.

**Help does not restate what the app already knows.** The ideas come from `NOTES`, the goals from
`PRESETS`, the scorecard rows from `TASKS`, the keys from `LISTED_SHORTCUTS` — and four tests
assert **identity, not similarity**, because a paraphrase is exactly the drift the arrangement
prevents. The prose that exists only here names its panels by element id, and a test reads
`index.html` to check every one is real.

**Each panel header carries a `?`** that opens help at that panel's own paragraph — seven of them.
Attachment happens last in `boot()` because four panels build their own header, and a header that
cannot be found is reported rather than skipped. The gait controls had no header at all until
now, which is why the busiest column began with an unlabelled row of sliders.

**`ui/keymap.ts` is now the only description of the shortcuts.** They were a ladder of `if`s in
`main.ts` plus a hardcoded hint strip, and help would have been a third copy. The handler
dispatches from the array, the hint strip is generated from it, help renders it.

**Full-screen overlays sat below the drawers** — `.stepper` at z-index 20 against the drawers at
30, so below 1000 px an open drawer covered the help text *and the stepper*, which had the bug
since slice 11. Anything covering the whole app has to outrank anything covering part of it.

**Slice 14 — "Task suite". The last slice on the list; nothing after it is planned.** Six tasks,
five seeds each, on ground the gait was never evolved on. A scorecard panel under the behaviour
map, and `npm run tasks` headless. §6 of the design document, **now amended** — the fifth
amendment block and the one that changed the most.

**§6 asked for eight tasks and two of them cannot exist.** Slalom needs a lateral axis to put a
gate beside and a steering gene to reach it; the physics is sagittal, so every gait would fail it
identically for a reason unrelated to the gait. Shove survives by being redefined as a fore/aft
impulse. Then measurement took a second one — see below.

**The gait that scores 6.4598 on flat ground is a bronze robot once tested**, held there by
Steps, the one task where it falls every time. The composite is the worst task, not the average,
so speed cannot buy it. That single line is §6's opening sentence demonstrated.

**A segmented ground is not a floor, and that cut Rough.** A Rapier heightfield puts twenty
contact points under a 16 cm foot where a cuboid puts two, and on *geometrically identical* flat
ground five gaits went from a mean 3.80 m to 0.64 m with 5/5 falling. A chain of rotated cuboids
— two points each — changed nothing, so it is the **seams**, not the count. Ramp and steps avoid
them (one rotated slab; one slab per tread) and a 0° ramp measures 2.84 m against flat's 2.84 m.
Rough cannot avoid them, and its amplitude then stops mattering: 1.70 m at 0 cm, 1.14 at 1 cm,
1.15 at 3 cm. *A task whose own parameter barely moves its result is broken, not hard.*

**"Geometrically identical" is not a safe refactor of physics setup.** Moving the ground's −0.5 m
offset from the rigid body onto the collider moved the golden number to 5.8015. Flat ground is
now an early return that reconstructs the original exactly, with the reason beside it.

**Three flat-ground assumptions are gone**: `fallen` is height above the ground *beneath the
torso*, contact is measured against `sim.groundAt(x)`, and stride and duty follow from contact.
`terrain.ts` lives in `packages/evolution` — pure arithmetic, no Rapier — so `tasks.ts` can name
a terrain without the search importing the simulator. `runSuite` takes an evaluator for the same
reason, which is what stops the CLI and the browser running two copies that drift.

**Thresholds are calibrated, not chosen** — `npm run tasks -- --calibrate`. Incline and Shove
were re-tuned by that table rather than by taste. **Falling caps a badge at bronze**: the first
scorecard printed `5/5 fell` and `GOLD` on the same line.

The scorecard runs in a **second instance of `island.worker.ts`**, not a second worker file —
Vite bundles per entry and `-compat` inlines Rapier's WASM into each. Its own worker because the
pool is lazy, so a gait can be scored before anything has been evolved.

**Slice 13 — "Community archive".** Publishing a run contributes its elites to a shared 24 × 24
grid, and the behaviour map gains a **Mine / Everyone** toggle. §5's last two endpoint rows, and
the one idea §15 says is worth taking out of the classroom feature. The design document needed
no amendment — the first slice where that is true.

**The numbers are the slice.** One published run put 244 cells in the map; a second at a
different seed found 83 of its own, **36 of which the first had already found**. So 47 were new,
and 208 of the shared 244 were ways that search never discovered. Quality–diversity in two
integers.

**A bin is decided once, from the full-precision behaviour, when the cell is claimed.**
`buildCommunity` first re-derived it from the stride and duty beside the cell, and 244 cells
arrived while 243 appeared: `serialise.ts` rounds to four decimals, and 0.87499 stored as 0.8750
is exactly a bin boundary, so it landed on its neighbour. `archiveInsert` now delegates to
`archivePlace`, which takes the index rather than deriving it — one rule, still written once,
golden 6.4598 unchanged. `archiveMerge` still re-derives and is safe, because its inputs were
never rounded.

**`EnsureCreated` does not upgrade, and 30 passing tests could not say so.** The new table never
appeared in the database slice 12 had created, so every `GET /api/archive` was a 500 while every
test passed — they all build a database from scratch. Slice 12's lesson, one level out: *fakes
cannot prove persistence behaviour; a fresh database cannot prove upgrade behaviour.*
`Schema.cs` creates missing tables from the model's own create script, so it cannot drift; its
limit is new tables, and needing a column change is the day §5's "revisit" has arrived.

**`archiveInsert` is written twice, in two languages, and only one test can tell.** Changing
`>=` to `>` in `ContributeAsync` fails the SQLite tie test and leaves the endpoint tie test
green — the fake carries its own copy of the rule. That tie direction is also what makes
republishing a no-op, which is why contribution is reported as **ownership, not a delta**.

**A dead control is worse than a failing one.** The Everyone button was disabled on failure,
which made a transient outage permanent — nothing retries, so the shared map was unreachable
without a reload. It stays enabled and clicking it retries.

**Slice 12 — "The server".** One ASP.NET Core project (net9.0, not §5's net10) serving the
built SPA at one origin, storing runs in SQLite and trajectories as content-addressed files.
Save a run, list them, reopen one, publish a read-only `?shared=<token>` link.

**The app works with no server at all, and that is measured.** Server killed mid-session:
thirty generations still evolved, **zero unhandled rejections**, no dialog, and one amber dot
in the toolbar. `npm run dev`/`test`/`evolve` need no .NET; `dotnet test` needs no Node.

**`api.ts` never throws**, so there is no `try`/`catch` anywhere else. Offline, timeout, 404,
500, an HTML error page from a proxy and a 200 with unparseable JSON all become an
`ApiResult` — the last two are the ones that get skipped and both have tests. Five-second
`AbortController` on every request: a hanging one gives neither an error to report nor a
result to use.

**Fakes prove endpoint behaviour and cannot prove persistence behaviour.** Eleven endpoint
tests passed against fakes while listing was broken in real SQL — SQLite refuses to
`ORDER BY` a `DateTimeOffset`, and the fake sorts one happily in LINQ-to-Objects. The server
500'd the first time it was run by hand. `CreatedAt` is UTC ticks now and `RepositoryTests`
uses real in-memory SQLite; mutation-tested.

**Runtime state never goes inside the source tree.** The data directory defaulted to
`ContentRootPath/data`, which on a case-insensitive filesystem *is* the source folder
`Data/` — a `rm -rf data` destroyed three uncommitted files. It lives in `server/.data` now.

**Slice 11 — "Challenge track".** Eleven cards in the left column, each naming the concept it
teaches, each configuring the app in one click. Nothing is locked — cards past the frontier
are dimmed as guidance and stay clickable, and a completed card is never dimmed.

**Afterwords are data that branches on the outcome.** Slice 6 established the rule; this slice
had to encode it, because challenges are data and cannot hold functions. Three tests guard it:
every placeholder names a real field, every branch renders clean, and the naive-objective
card's walking branch is asserted *not* to mention falling. It earned its keep immediately —
the first live run of that card walked 6.1 m instead of diving.

**Card 6 caught the same bug in my own copy.** It said "The line dips" unconditionally; with
four islands that is likely, not certain. `Outcome` gained `bestDips`, counted from the
chart's own series, and the card now branches. Measured five dips, largest 0.512 — which also
verifies the new `gaOverrides` plumbing reaches the workers.

**The stepper runs its own island**, so nothing it does reaches the pool — which is why the
two stepper cards checked a number stepping could never move, and could not be completed by
doing what they asked. `Outcome` gained `stepperSelections`/`Crossovers`/`Mutations`, the only
fields not measured from a run and deliberately not persisted: the point is that you *saw* it.

**Progress is per concept, not per card**, in `localStorage` — the first state in this project
that cannot live in the URL. The parse is defensive because that key is user-writable and
outlives the code reading it: junk degrades to empty rather than throwing on boot.

**Slice 10 — "Gait analysis".** A strip under the stage — footfall diagram, six joint-angle
traces, hip phase portrait — present only when there is a recording to draw. In manual mode
the replay is live and there is nothing to scrub, so the panels are absent rather than blank.

**Nothing in this slice re-runs the simulation**, and a test enforces it: every file under
`render/gait/` is scanned for `evaluate(`, `new Sim` and `stepControlled`, and the only
runtime imports allowed from `@evolab/sim` are the two duty helpers. The moment a panel
simulates, watching a gait costs as much as evolving one.

**One time axis, one frame index.** `common.ts` owns `frameToX`/`xToFrame`; the footfall
diagram and traces share a grid column so their widths — and therefore their axes — are
identical, and a reader can draw a vertical line down the two with their eye. `playFrame`
lives in `main.ts` and the panels are passed it; none keeps a copy.

**The replay now records exactly `trialSeconds`, not twice it.** Slice 9's doubled window
made the footfall diagram's duty factor disagree with the behaviour map's cell beside it —
0.83 against 0.80 — with nothing on screen to explain why. The scrubber now shows the run that
produced the numbers next to it. A residual half-percentage-point gap remains because the
trial counts stance at 240 Hz and the recording stores it at 60 Hz; the caption states the
window and a test bounds the gap explicitly at one point.

**Slice 9 — "3D replay".** A `2D`/`3D` toggle in the toolbar (or `2`/`3`) swaps the stage for
an orbitable Three.js scene: drag to turn, wheel to zoom, double-click to reset. Champions
play back from a **recorded trial** with a scrubber; manual gaits still play live, because
dragging a slider and seeing the next step change is the whole reason the sliders exist.

**The physics is still 2D and the view does not hide it.** Orbit to the front and the legs are
perfectly aligned laterally, because nothing in the eleven-gene genome moves in that axis.
Moving to `rapier3d` would invalidate every fitness number in the project to buy a sideways
fall evolution has no lever to correct. **Written into the design document** as amendments to
§2, §4 and §9 — `rapier3d-compat` is not a dependency and the full-3D throughput rows are
marked hypothetical.

**`bodies.ts` imports nothing from Three and that is load-bearing.** Every decision about how a
sagittal simulation becomes a 3D scene — leg separation in z, box depth, camera focus — is
arithmetic on a `Snapshot`, tested in Node without a WebGL context. `scene.ts` is the only
file in the project that imports Three, only ever through a dynamic `import()`, and it lands
in its own 517 kB chunk. If `apps/web/__tests__/bodies.test.ts` becomes impossible to write,
the render layer has stopped being separable.

`evaluate` gained `record: true`, **off by default and it must stay that way** — the search
runs it tens of thousands of times per study. `npm run evolve` is 9.24 s against 9.37 s before
recording existed, which is the evidence. The format is deliberately wider than the 3D replay
needs: it carries joint angles and per-foot contact because slice 10 reads the same recording.
`snapshotAt` rebuilds a `Snapshot`, so one scrubber drives both renderers and they cannot
drift apart.

**Slice 8 — "Behaviour archive".** A MAP-Elites grid rides alongside the GA: 24 × 24 cells
keyed by **stride length** (0–1.4 m) and **duty factor** (0.5–1.0), each holding the fittest
genome that ever behaved that way. Hover a cell for its numbers; click it to load that gait
into the sliders. `npm run evolve` prints the same map as ASCII.

**Neither descriptor is scored.** That is the whole point — nothing selects for them, so the
spread across the grid is a fact about what the search *found* rather than what it was told
to look for. A run ending with one brilliant cell and 575 empty ones has not explored,
whatever its maximum says. Coverage and the improvement rate are both better signals of a
stalled search than a flat best-fitness line.

**The archive observes the search and is never an input to it.** A test drains one island's
archive every generation and asserts the population stays bit-identical; the golden 6.4598 is
unchanged. Making it a real MAP-Elites search — sampling parents from the grid — is a
different algorithm, and it would make the slice 5 stepper, which draws tournament selection,
a lie.

Foot contact is a **geometry test on the snapshot**, not a Rapier `EventQueue`: the ground is
a plane at y = 0 and the feet are boxes, so the lowest corner of an oriented box is cheaper
and testable in Node. The 5 mm threshold was **swept, not guessed** — touchdowns are flat at
7 per foot from 1 mm to 10 mm and collapse at 20 mm. Revisit when the floor stops being flat.

Both axis ranges in the original spec were wrong and running it is what showed it. Duty
0.35–0.85 wasted two thirds of the grid because this biped never gets airborne; stride
capping at 0.95 m put the champion (0.923 m) in the last column with no headroom.

Workers report **only the cells that changed**, as transferred typed arrays, and `IslandPool`
folds them into one map through `archiveInsert` so a collision between islands resolves under
the same rule each island used on itself. Single island, 30 generations: 24% coverage. Four
islands, same 30: **44%**.

**Slice 7 — "Body editor".** In Lab, the biped is editable: segment lengths and widths,
foot geometry, density, with live mass, height, balance margin and hip load, and validation
that explains *why* a body cannot work rather than just refusing it. Bodies round-trip
through `?body=`.

The editor edits a **`BipedSpec`** and `buildBiped(spec)` derives the morphology, so the
kinematic chain closes by construction and the feet always rest exactly on y = 0. Symmetry
is not a lock, it is the type — one spec describes both legs.

**The topology is fixed at six joints on purpose.** That keeps the genome at eleven genes
whatever the body, so an evolved gait can be dropped onto a different set of legs. Evolve a
gait, lengthen the legs, watch it fall over — nothing else in the project makes the coupling
between body and controller so obvious so fast.

Changing the body rebuilds the replay immediately but only marks the worker pool stale;
every fitness in it was measured on the old body, and rebuilding four workers per slider
tick would be unusable.

**React is not in this project, and that is now a decision rather than a deferral** — an
amendment to §12 of the design document, reasoned in the slice 7 notes.

**Slice 6 — "Guided first run".** The app opens in a guided flow: pick a body, choose a
goal, watch 24 robots evolve, see what changed. No sliders, four preset goals, and step 4
replays the first attempt against the champion. About 2,600 robots in 8 seconds, typically
2.5 m → 6.3 m.

Guided / Explorer / Lab switch in the toolbar and **nothing is locked in either direction**
— stages only decide which panels are present (`data-stage` on `<body>`, `.explorer-only`
and `.lab-only` in CSS). Switching never restarts the search.

One preset — *Just reach the line, anything goes* — scores distance and nothing else, on
purpose. Its afterword is a **function of the outcome**, not a fixed string, because
evolution does not reliably misbehave and copy that asserts a face-plant when the robot
plainly walked teaches the reader to stop reading. See §7 on explanations written against
live values.

**React is still not here, and that was a decision** — the reasoning and the trigger
condition are in the slice 6 notes. Slice 7's body editor is where it arrives.

**Slice 5 — "The stepper".** The teaching screen. *Show me how this works →* in the
toolbar, or `S`, opens a full-screen stepper that pauses the algorithm between operators
and shows each one acting on real genomes — gene strips, tournament draws, crossover
provenance, mutations with the gene named and the delta shown.

It drives `generation(island, evaluate, { trace: true })`, the same function the workers
drain at full speed. **Not an illustration of the algorithm — the algorithm, paused.**
A test asserts traced and untraced runs are identical, because the moment that stops being
true the screen becomes a lie.

The generator yields **per breeding pair** (`select → crossover → mutate`), never per
phase. Grouping the phases would reorder the random draws and silently invalidate every
stored gait. If you touch `breed()`, the golden test and `npm run evolve` returning 6.4598
are what tell you the order survived.

Behind it, the search still runs in Web Workers, one island each, trading two elites round
a ring every five generations — 88 trials/s on one worker and 329 on four, **3.7× on four
cores**, with a 40-generation run in about 11 seconds.

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

**Every slice on the list is built.** Slices 0–14, and nothing after 14 was ever planned. What
remains is the list of things deliberately left out, each recorded in its slice's *Deliberately
not in this slice* section — the largest being that nothing uploads a trajectory yet, carried
from slice 12: the endpoint and content-addressed store exist and are tested, and nothing calls
them.

The five design-document amendments (§2, §4, §9, §10, §6) are the honest record of where the
spec and the build disagreed. Three of them trace to one decision — the physics stayed 2D — and
§6's second cut traces to a contact solver nobody could have predicted from a document.

**§10 is amended, and it was wrong in every column of its bottom two rows.** Monitor mode is
*view a finished run, read-only* — what `?shared=<token>` does, at any width — not the live
subscription Fig 10.1 describes, because §5 deleted SignalR along with the cloud islands.
Evolution never becomes remote; editing never becomes read-only. The only rule that survived is
the touch-device worker cap, and that one is not a breakpoint rule.

Slice 8 was the natural stopping point. Everything from here changes how the search is
watched, not how it works.

Two rules the GA earned the hard way, both written up in the slice 2 section:

- **If a score survives across generations, the conditions it was scored under must not
  change.** Elites are not re-evaluated, so a per-generation trial seed let a lucky genome
  keep a stale high fitness. `IslandConfig.trialSeed` is fixed for a whole run.
- **A champion is tuned to the one perturbation it was scored on.** `npm run evolve`
  re-tests it on five unseen tilts and prints the spread, because a gait that only works
  once is not a gait.

Before starting a slice, read its section. After finishing one, rewrite that section to
describe what was actually built and expand the next one.

**§12 of the design document is now audited against `package.json`.** The stack table has a
status column, and the whole project has five dependencies: TypeScript, Vitest, Vite, Three and
`rapier2d-compat`. Five of its thirteen rows named a library that never arrived — React,
react-three-fiber, uPlot, Zustand and Comlink — and three of those trace to the single decision
not to use React. If a dependency is added, that table is the thing to update.

**The chassis degrades below 1000 px** — §10 of the design document. The side panels stop
taking grid space and become overlay drawers the stage runs under, reached from two toolbar
buttons; below 600 px the phase portrait goes so the footfall diagram and traces get the full
width. The two fixed columns are 576 px between them, so at 640 px the stage had been getting
64 px. §10 asked for three bands; once the panels could overlay, the middle one had nothing left
to do, and the section now says so.

The toolbar collapses into a ⋯ menu rather than clipping, and the controls are **moved, not
cloned**, because every one is wired by id in `main.ts`.

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
packages/evolution/   pure TS — rng, types, GA operators, fitness, behaviour archive
packages/sim/         Rapier wrapper — morphology → world, step, record trajectories
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

`npm test` is 244 tests in about 1.5 s, so there is no excuse for not running it. It covers
the RNG (including a pinned golden vector), the controller, the morphology, the archive, the
trajectory recording, and the physics — the last of these builds real Rapier worlds and is
still fast enough to sit in the inner loop. It also covers `render/three/bodies.ts` under
`apps/web`, which is the only app-level module with tests and only because it deliberately
imports nothing from Three.

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
- The **2D** renderer nudges the far leg sideways (`FAR_LEG_RENDER_OFFSET` in
  `render/draw.ts`) because a strictly sagittal biped's legs overlap exactly at rest and it
  looks like a pogo stick. That offset is the only place the 2D drawing disagrees with the
  simulation. Zero it when checking a screen position against a world coordinate.

  The **3D** renderer must not apply it. There the legs are genuinely separated in z by
  `lateralOffset` in `render/three/bodies.ts`, and doing both would separate them twice, by
  different amounts, in the two views.
- Prefer plain functions and plain objects. No classes unless there is state with a
  lifecycle (`Rng` is the current exception).
- Commit per slice. Put the observable result in the message — "biped falls over in 1.2 s",
  later a golden fitness number.

## Things not to do

- Do not tune physics parameters to make the walk look better. Evolution compensates for a
  mediocre model far better than hand-tuning does, and a weekend disappears into friction
  coefficients with nothing to show. Ship the numbers in the design doc until the GA runs.
- Do not make the 3D view the default, and do not let it grow features the 2D view lacks.
  Debugging evolution through a 3D view is harder than through a 2D one, which is why 2D is
  still the teaching surface and the thing the guided flow shows.
- Do not start the .NET server before slice 12. It is the familiar, comfortable part and it
  serves a client that does not exist yet. The design doc says this out loud in §5 for a
  reason.
- Do not "tidy up" working simulation code without the golden test passing before and after.
