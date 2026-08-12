import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TIMEOUT_MS, api, clearFailures, normaliseError, onFailuresChanged, problemToError,
  recentFailures, reported,
} from '../src/net/api.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  clearFailures();
});

/** A `fetch` that answers once, however we like. */
function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Promise<never>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

const jsonResponse = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }));

describe('turning a response into an ApiError', () => {
  it('reads a well-formed ProblemDetails', () => {
    const error = problemToError(404, {
      type: 'https://evolab/errors/run-not-found',
      title: 'That run does not exist',
      status: 404,
      traceId: '00-8f3c9a-01',
      code: 'run_not_found',
    }, 1234);
    expect(error).toEqual({
      code: 'run_not_found',
      message: 'That run does not exist',
      status: 404,
      traceId: '00-8f3c9a-01',
      at: 1234,
    });
  });

  it('falls back to a readable message when the body says nothing useful', () => {
    // A 500 with an empty ProblemDetails still has to produce a sentence, and one that does
    // not blame the reader or leak that anything was lost — because nothing was.
    const error = normaliseError(500, {}, 0);
    expect(error.code).toBe('http_500');
    expect(error.message).toMatch(/Nothing was lost/);
    expect(error.traceId).toBeUndefined();
  });

  it('survives a body that is not an object at all', () => {
    // The case that gets skipped and then happens: a proxy returning an HTML error page, or
    // a body that parsed to a string, an array or null.
    for (const body of ['<html>502 Bad Gateway</html>', ['nope'], null, 42]) {
      const error = normaliseError(502, body, 0);
      expect(error.code).toBe('http_502');
      expect(error.message.length).toBeGreaterThan(10);
      expect(error.message).not.toContain('undefined');
    }
  });

  it('never lets a missing title become the string "undefined"', () => {
    expect(normaliseError(400, { code: 'bad_run' }, 0).message).not.toMatch(/undefined/);
    expect(normaliseError(400, { title: '   ' }, 0).message).not.toMatch(/^\s*$/);
  });
});

describe('every failure mode produces a result, never an exception', () => {
  it('a 404 with ProblemDetails', async () => {
    stubFetch(() => jsonResponse(404, { title: 'Gone', code: 'run_not_found' }));
    const result = await api.getRun('abc');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('run_not_found');
  });

  it('a 500', async () => {
    stubFetch(() => jsonResponse(500, { code: 'server_error' }));
    const result = await api.listRuns();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(500);
  });

  it('the server not being there at all', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const result = await api.listRuns();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('offline');
      expect(result.error.status).toBe(0);
      // The message has to say the app still works, because it does.
      expect(result.error.message).toMatch(/Evolving still works/);
    }
  });

  it('a timeout', async () => {
    stubFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    const result = await api.listRuns();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('timeout');
  });

  it('an HTML error page from a proxy', async () => {
    // 502 with a text/html body — `.json()` on this throws, which without care looks
    // identical to the network being down.
    stubFetch(() => Promise.resolve(new Response('<html>502</html>', { status: 502 })));
    const result = await api.listRuns();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(502);
      expect(result.error.code).toBe('http_502');
    }
  });

  it('a 200 whose body is not the JSON it claims to be', async () => {
    stubFetch(() => Promise.resolve(new Response('{ this is not json', {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    const result = await api.listRuns();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('malformed');
  });

  it('and a success still succeeds', async () => {
    stubFetch(() => jsonResponse(200, [{ id: 'a', title: 'run' }]));
    const result = await api.listRuns();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
  });
});

describe('requests are bounded', () => {
  it('aborts rather than hanging for ever', async () => {
    // A hanging request produces no error to report and no result to use, so nothing
    // resolves — the worst outcome available, and the one a timeout exists to prevent.
    vi.useFakeTimers();
    let aborted = false;
    stubFetch((_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
    }));

    const pending = api.listRuns();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 10);
    const result = await pending;

    expect(aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('timeout');
    vi.useRealTimers();
  });
});

describe('the report ring', () => {
  it('keeps the most recent failures, newest first', () => {
    for (let i = 0; i < 8; i++) {
      reported({ ok: false, error: normaliseError(500, { code: `e${i}` }, i) });
    }
    const seen = recentFailures();
    expect(seen).toHaveLength(5);
    expect(seen[0]!.code).toBe('e7');
    expect(seen[4]!.code).toBe('e3');
  });

  it('records nothing on success, and hands the result back either way', () => {
    const ok = reported({ ok: true as const, data: 42 });
    expect(ok).toEqual({ ok: true, data: 42 });
    expect(recentFailures()).toHaveLength(0);
  });

  it('tells the indicator when something changed', () => {
    let notified = 0;
    const off = onFailuresChanged(() => notified++);
    reported({ ok: false, error: normaliseError(500, {}, 0) });
    expect(notified).toBe(1);
    clearFailures();
    expect(notified).toBe(2);
    off();
    reported({ ok: false, error: normaliseError(500, {}, 0) });
    expect(notified).toBe(2);
  });
});
