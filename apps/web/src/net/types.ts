/**
 * The wire, from the browser's side — slice 12.
 *
 * Two shapes and no behaviour, so the pure parts can be tested in Node and the module that
 * actually calls `fetch` stays small enough to read in one sitting.
 */

/**
 * Every server call returns one of these. **Nothing in `net/` ever throws**, so there is no
 * `try`/`catch` anywhere else in the app — offline, timeout, a 404, a 500, an HTML error page
 * from a proxy and a 200 with unparseable JSON all arrive here as `ok: false`.
 */
export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ApiError };

export interface ApiError {
  /**
   * Short, stable, machine-readable. From the server's `code` extension when there is one,
   * otherwise one of the client-side kinds below.
   *
   * Stable is the point: `message` is copy and copy gets reworded, so anything that branches
   * branches on this. Same argument as denormalising the objective weights onto a stored run.
   */
  readonly code: string;
  /** Safe to show a human. Never an exception message — the server does not send those. */
  readonly message: string;
  /** HTTP status, or 0 when the request never arrived. */
  readonly status: number;
  /** Pairs a browser report with a server log line. Absent when the request never arrived. */
  readonly traceId?: string;
  readonly at: number;
}

/** Failures that happen before a response exists, so the server cannot name them. */
export const CLIENT_CODES = {
  offline: 'offline',
  timeout: 'timeout',
  /** A response arrived and was not the JSON it claimed to be. */
  malformed: 'malformed',
} as const;

/**
 * RFC 9457 `ProblemDetails`, plus the one extension this project adds.
 *
 * Declared loosely on purpose: this is what arrives over a wire, not what we constructed, and
 * a proxy returning an HTML error page will not honour any of it.
 */
export interface ProblemDetails {
  readonly type?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly detail?: unknown;
  readonly traceId?: unknown;
  readonly code?: unknown;
}

/* ---------------- what a run is, on the wire ---------------- */

export interface RunSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly title: string;
  readonly championFitness: number;
  readonly championDistance: number;
  readonly generations: number;
  readonly shareToken?: string;
}

export interface RunRecord extends RunSummary {
  readonly seed: number;
  readonly population: number;
  readonly trialSeconds: number;
  readonly workers: number;
  /**
   * The preset key **and** the weights it meant at the time.
   *
   * Denormalised deliberately. Presets are copy and copy gets reworded; a stored run must
   * always be able to say what it was actually scored on, not what a preset of that name
   * means today. The same rule as `IslandConfig.trialSeed` in slice 2 — if a score survives,
   * the conditions it was scored under must not change.
   */
  readonly goalKey: string;
  readonly goalDistance: number;
  readonly goalUpright: number;
  readonly goalEffort: number;
  readonly goalEffortBudget: number;
  /** The eleven numbers of `encodeSpec`. */
  readonly bodySpec: string;
  /** The eleven genes, comma-separated, as `encodeGait` writes them. */
  readonly championGenome: string;
  readonly championUpright: number;
  readonly championEffort: number;
  readonly championFell: boolean;
  readonly championStride: number;
  readonly championDuty: number;
  /** Filled archive cells only: index, fitness, stride, duty, then `genomeLength` genes. */
  readonly archive: readonly ArchiveCellDto[];
  /** Best / mean / diversity per generation, for the chart. */
  readonly history: readonly HistoryPointDto[];
  /** Content hash of the recorded trajectory, when one was uploaded. */
  readonly trajectoryHash?: string;
}

export interface ArchiveCellDto {
  readonly index: number;
  readonly fitness: number;
  readonly stride: number;
  readonly duty: number;
  /** Comma-separated, as `serialise.ts` writes them. */
  readonly genes: string;
}

/* ---------------- the community archive — slice 13 ---------------- */

/**
 * One cell of the shared grid.
 *
 * `bodySpec` is not decoration. Slice 7 fixed the topology at six joints so a genome could be
 * dropped onto different legs; a cell contributed by a run with longer shins is eleven numbers
 * that strode 0.92 m *on that robot*, and may be a face-plant on the one currently on screen.
 * The client compares this against the body being edited and says which case it is.
 */
export interface CommunityCellDto extends ArchiveCellDto {
  readonly runTitle: string;
  readonly bodySpec: string;
}

export interface CommunityDto {
  readonly cells: readonly CommunityCellDto[];
  /** Runs represented **in this map** — not runs ever published. */
  readonly runs: number;
}

/** What publishing did: the link, and what the run now holds in the shared map. */
export interface Published {
  readonly token: string;
  readonly owned: number;
  readonly total: number;
}

export interface HistoryPointDto {
  readonly generation: number;
  readonly best: number;
  readonly mean: number;
  readonly diversity: number;
}
