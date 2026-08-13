# Evolab

A browser app for designing two-legged robots, evolving their walking gaits with a genetic
algorithm, and learning how both work by watching them happen.

Nothing here is an animation. Every robot on screen is simulated from its own physics, and every
number beside it was measured from that simulation — when a robot falls over, it is because it
fell over.

---

## What it is for

**Teaching tool first, simulator second.** That ordering decides most of the arguments in this
codebase. Where a choice was available between a more capable simulation and a more legible one,
the legible one won.

Three things follow from it:

**The algorithm is watchable, not illustrated.** Pressing `S` opens a stepper that pauses the
genetic algorithm between its operators and shows each one acting on the real genomes — the same
function the workers run at full speed, held still. A test asserts a traced run and an untraced
run are identical, because the moment that stops being true the screen becomes a lie.

**The search is shown by what it found, not only by what it scored.** A MAP-Elites behaviour
archive rides alongside the GA, filing every gait by *how* it moved — stride length against duty
factor — rather than by how well. Nothing selects for either, so the spread across that grid is a
fact about what the search stumbled into. A run ending with one brilliant cell and 575 empty ones
has not explored, whatever its best number says.

**A score on flat ground is not a robot.** A task suite runs any gait over six tasks on ground it
was never evolved on and returns a scorecard. The composite badge is the *worst* task, not the
average, so speed cannot buy it. The reference champion scores 6.4598 while evolving and comes
out **bronze** once tested, which is the whole argument in one line.

It is a personal project, built in sixteen slices (0–15). Every slice is written up in
[docs/implementation.md](docs/implementation.md) — including the parts that turned out to be
wrong, which are usually the useful bits.

---

## Running it

Two independent halves. **The frontend is the application** — the search, the physics and the
charts all run in the browser tab. The backend only adds persistence, and the app is fully usable
without it.

### Frontend — required

- **Needs:** Node 22 or newer. The CLI scripts run TypeScript directly via
  `--experimental-strip-types`, so there is no build step for tests or scripts.
- **Opens on:** **http://localhost:5173**

```bash
npm install        # once, from the repo root
npm run dev
```

New to it? Press `?` for a help section written for someone who has never seen a genetic
algorithm — what this is, a five-step first run, what every panel means, and a glossary of every
number on screen. Every panel header also has its own `?`.

### Backend — optional

- **Needs:** .NET 9.
- **Listens on:** **http://localhost:5000** — the dev server proxies `/api` to it, so keep both
  running and carry on using http://localhost:5173.
- **Adds:** saved runs, read-only share links, and the community behaviour map.
- **Stores it in:** `server/.data/` — a SQLite file and content-addressed trajectory blobs.

```bash
dotnet run --project server/Evolab.Server
```

**The app works with no server at all, and that is measured rather than claimed:** with the
server killed mid-session, thirty generations still evolve, no dialog appears, and there are zero
unhandled rejections. The only visible difference is one amber dot in the toolbar.

### Both together, as one deployment

`npm run build` writes the SPA into the server's `wwwroot`, so `dotnet publish` produces a single
artefact serving the app and the API from one origin.

### Useful URL parameters

`?seed=42` `?gens=60` `?pop=32` `?workers=1` `?stage=lab` `?view=3d` `?goal=efficient`

`?workers=1` is the one to reach for when comparing runs: a single island is bit-reproducible,
and more than one is not, because migration is asynchronous.

---

## Commands

| | |
|---|---|
| `npm run dev` | The app, at http://localhost:5173 |
| `npm test` | 314 unit tests, about 1.5 s |
| `npm run check` | Typecheck everything |
| `npm run build` | Build the SPA into the server's `wwwroot` |
| `npm run sim` | Headless: step the biped in Node, print positions |
| `npm run evolve` | Headless search — 30 generations, ~9 s, prints the behaviour map as ASCII |
| `npm run tasks` | Put a gait through the task suite and print its scorecard |
| `dotnet test` | 30 server tests (from `server/Evolab.Server.Tests`) |

Two long-form variants worth knowing:

```bash
npm run evolve -- --gens 120 --seconds 8      # the long one, ~70 s, reaches 17.7 m
npm run tasks -- --calibrate                  # every task's raw numbers across five gaits
```

**The two toolchains are independent.** `npm run dev`, `npm test` and `npm run evolve` all work
with .NET absent; `dotnet test` needs no Node. There is no orchestration between them.

---

## What is in the repo

```
packages/evolution/   pure TypeScript — RNG, GA operators, fitness, behaviour archive,
                      terrain profiles, the task suite. No DOM, no physics engine, no I/O.
packages/sim/         the Rapier wrapper — morphology → world, step, record trajectories.
                      Owns the physics engine and knows nothing about genomes.
apps/web/             the Vite app — canvas rendering, Web Workers, panels, help.
server/               ASP.NET Core Minimal API — saved runs, share links, community archive.
scripts/              headless entry points for the CLI commands above.
docs/                 the three documents below.
```

Packages are consumed as source through Vite aliases, so there is no build step for them and
there should not be one.

The whole project has **five dependencies**: TypeScript, Vitest and Vite to build and test it,
Three and `rapier2d-compat` at runtime.

---

## The documents

- **[docs/technical-design.html](docs/technical-design.html)** — the architecture and UI
  specification. Open it in a browser. Sixteen sections, seventeen figures, and every
  architectural decision with the reasoning that produced it. It is stable, and where the build
  proved it wrong it carries an amendment rather than a quiet edit — there are five.
- **[docs/code-design.html](docs/code-design.html)** — how the code itself is organised, written
  for someone who has never seen the project. The four layers and why dependencies only point one
  way, the nine types everything is made of, what each module does, and the five patterns that
  repeat. Ten diagrams. Start here if you are going to change something.
- **[docs/implementation.md](docs/implementation.md)** — how each slice was built and in what
  order, with the measurements that settled each decision. A living document.
- **[CLAUDE.md](CLAUDE.md)** — the working context: current state, the invariants, and the
  mistakes worth not repeating.

If this file and the design document disagree, the design document wins. If the implementation
guide and the code disagree, the code wins and the guide is stale.

---

## Two things to know before changing anything

**The golden number is 6.4598.** A single-island run at seed 4417 for 30 generations produces
exactly that fitness, and a test pins it. It is the project's tripwire for accidental changes to
the physics or the operator order — including changes that look like they cannot matter. Moving
the ground collider's offset from the rigid body onto the collider is geometrically identical and
moved it to 5.8015.

**Randomness is seeded, always.** There is no `Math.random()` anywhere in `packages/`; an `Rng`
instance is threaded through explicitly. That is what makes runs reproducible and the golden test
possible, and it is the invariant most easily broken by accident.

The rest of the invariants are in [CLAUDE.md](CLAUDE.md), and each one is a rule some past
session learned the hard way.

---

## Licence

[MIT](LICENSE).
