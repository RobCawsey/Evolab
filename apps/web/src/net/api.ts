/**
 * The only place in the app that calls `fetch` — slice 12.
 *
 * **Nothing here throws.** Every failure mode becomes an `ApiResult`, which is what lets the
 * rest of the app have no `try`/`catch` in it and no path where a dead server matters. The
 * app worked for eleven slices with no server at all and must keep doing so exactly.
 *
 * `normaliseError` and `problemToError` are pure and carry all the reasoning, so they test in
 * Node like everything else that matters. What is left is one `fetch` wrapper.
 */

export type { ApiError, ApiResult } from './types.ts';

import {
  CLIENT_CODES,
  type ApiError,
  type ApiResult,
  type CommunityDto,
  type ProblemDetails,
  type Published,
  type RunRecord,
  type RunSummary,
} from './types.ts';

/**
 * Five seconds.
 *
 * A hanging request is worse than a failed one: it produces no error to report *and* no
 * result to use, so nothing ever resolves and the "never blocks" guarantee quietly stops
 * holding. The largest thing sent is a run of about 60 kB.
 */
export const TIMEOUT_MS = 5_000;

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

/** Plain-language fallbacks, by status. The server usually supplies better. */
function fallbackMessage(status: number): string {
  if (status === 0) return 'No connection. Evolving still works — nothing is being saved.';
  if (status === 404) return 'That is not here any more.';
  if (status === 413) return 'That run is too large to save.';
  if (status >= 500) return 'The server had a problem. Nothing was lost — try again later.';
  if (status >= 400) return 'The server refused that request.';
  return 'Something went wrong talking to the server.';
}

/** A well-formed `ProblemDetails` body → an `ApiError`. */
export function problemToError(status: number, problem: ProblemDetails, at: number): ApiError {
  const traceId = typeof problem.traceId === 'string' ? problem.traceId : undefined;
  return {
    code: text(problem.code, `http_${status}`),
    message: text(problem.title, fallbackMessage(status)),
    status,
    ...(traceId === undefined ? {} : { traceId }),
    at,
  };
}

/**
 * A status and whatever came back → an `ApiError`.
 *
 * The two cases worth writing tests for are the ones that get skipped: a body that is not
 * JSON at all, which is what a proxy or a load balancer returns, and a body that parsed but
 * is not a `ProblemDetails` — an array, a string, `null`. Both have to produce something a
 * human can read rather than `undefined`.
 */
export function normaliseError(status: number, body: unknown, at = Date.now()): ApiError {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    return problemToError(status, body as ProblemDetails, at);
  }
  return { code: `http_${status}`, message: fallbackMessage(status), status, at };
}

function clientError(code: string, message: string, at = Date.now()): ApiError {
  return { code, message, status: 0, at };
}

/* ---------------- the one fetch ---------------- */

/** Where the API lives. Same origin in production; Vite proxies `/api` in development. */
const BASE = '/api';

interface RequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Perform a request and convert every outcome into an `ApiResult`.
 *
 * The `catch` here is the only one in the application. `AbortError` is separated from a
 * genuine network failure because the two mean different things to a reader: one says the
 * server is slow, the other says it is not there.
 */
async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(BASE + path, {
      method: opts.method ?? 'GET',
      signal: controller.signal,
      ...(opts.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body) }),
    });

    // Read as text first. A proxy returning HTML with a 200 is a real thing, and `.json()`
    // on it throws in a way that would otherwise look like a network failure.
    const raw = await response.text();
    let parsed: unknown = null;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return response.ok
          ? {
              ok: false,
              error: clientError(
                CLIENT_CODES.malformed,
                'The server sent something this app could not read.',
              ),
            }
          : { ok: false, error: normaliseError(response.status, null) };
      }
    }

    if (!response.ok) return { ok: false, error: normaliseError(response.status, parsed) };
    return { ok: true, data: parsed as T };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? clientError(CLIENT_CODES.timeout, 'The server took too long to answer.')
        : clientError(CLIENT_CODES.offline, fallbackMessage(0)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- the endpoints ---------------- */

export const api = {
  listRuns: (): Promise<ApiResult<RunSummary[]>> => request('/runs'),
  getRun: (id: string): Promise<ApiResult<RunRecord>> => request(`/runs/${id}`),
  saveRun: (run: unknown): Promise<ApiResult<RunSummary>> =>
    request('/runs', { method: 'POST', body: run }),
  /** Mints a share token **and** contributes this run's elites to the community archive. */
  publishRun: (id: string): Promise<ApiResult<Published>> =>
    request(`/runs/${id}/publish`, { method: 'POST' }),
  getShared: (token: string): Promise<ApiResult<RunRecord>> => request(`/shared/${token}`),
  /** At most 576 cells, however many runs are behind them. */
  getCommunity: (): Promise<ApiResult<CommunityDto>> => request('/archive'),
};

/* ---------------- the report ring ---------------- */

/**
 * The last few failures, for the toolbar indicator — Fig 9.9.
 *
 * Deliberately tiny and in memory. It exists so a failure is *reportable*, not so it is
 * recoverable: there is no retry here, because a run that failed to upload can be sent again
 * from the run itself and a retry queue is machinery nobody asked for.
 */
const RING = 5;
const failures: ApiError[] = [];
const listeners = new Set<() => void>();

export function reportFailure(error: ApiError): void {
  failures.unshift(error);
  if (failures.length > RING) failures.length = RING;
  for (const listener of listeners) listener();
}

/** Record a failure and hand the result straight back, so call sites stay one line. */
export function reported<T>(result: ApiResult<T>): ApiResult<T> {
  if (!result.ok) reportFailure(result.error);
  return result;
}

export function recentFailures(): readonly ApiError[] {
  return failures;
}

export function clearFailures(): void {
  failures.length = 0;
  for (const listener of listeners) listener();
}

export function onFailuresChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
