/**
 * Evaluating a `Check` and rendering an `Afterword`. The only part of slice 11 with logic.
 *
 * Pure, so it tests in Node like `render/three/bodies.ts` does — no DOM, no state, no clock.
 * Every card depends on it, which is why it was built and tested before any card was written.
 */

import {
  OUTCOME_KEYS,
  type Afterword,
  type Check,
  type Metric,
  type Outcome,
} from './types.ts';

const OUTCOME_KEY_SET: ReadonlySet<string> = new Set<string>(OUTCOME_KEYS);

export function isMetric(name: string): name is Metric {
  return OUTCOME_KEY_SET.has(name);
}

/** Does this check hold for this outcome? */
export function evaluateCheck(check: Check, outcome: Outcome): boolean {
  if ('all' in check) return check.all.every((c) => evaluateCheck(c, outcome));
  if ('any' in check) return check.any.some((c) => evaluateCheck(c, outcome));
  if ('not' in check) return !evaluateCheck(check.not, outcome);

  const actual = outcome[check.metric];
  switch (check.op) {
    case '>=': return actual >= check.value;
    case '<=': return actual <= check.value;
    case '>': return actual > check.value;
    case '<': return actual < check.value;
    // Tolerant equality. Every metric is a float, and `championFell == 1` should not turn on
    // whether 1 survived a round trip through a Float32Array intact.
    case '==': return Math.abs(actual - check.value) < 1e-9;
    case '!=': return Math.abs(actual - check.value) >= 1e-9;
  }
}

/**
 * `{metric}` and `{metric:2}` — the number, optionally to a fixed number of decimals.
 *
 * Deliberately the whole of the template language. Anything richer becomes a small
 * expression evaluator that has to be tested, documented and then defended against, and the
 * eleven cards want to quote a number and occasionally round it.
 */
const PLACEHOLDER = /\{([a-zA-Z]+)(?::(\d))?\}/g;

/** Default decimals per metric, so a card can usually write `{championDistance}` and be right. */
const DECIMALS: Partial<Record<Metric, number>> = {
  championDistance: 1,
  championFitness: 2,
  championUpright: 1,
  championEffort: 0,
  championStride: 2,
  championDuty: 2,
  championFell: 0,
  firstDistance: 1,
  firstFitness: 2,
  generations: 0,
  diversity: 3,
  coverage: 0,
  archiveCells: 0,
  trialSeconds: 0,
  population: 0,
};

function format(metric: Metric, value: number, override: string | undefined): string {
  if (override !== undefined) return value.toFixed(Number(override));
  // Coverage is stored as a fraction and read as a percentage — the one metric whose natural
  // written form is not its stored form.
  if (metric === 'coverage') return `${(value * 100).toFixed(0)}%`;
  return value.toFixed(DECIMALS[metric] ?? 2);
}

export function interpolate(text: string, outcome: Outcome): string {
  return text.replace(PLACEHOLDER, (whole, name: string, decimals: string | undefined) => {
    // An unknown placeholder is left verbatim rather than replaced with "undefined". A test
    // asserts none exist, so this only ever shows up while authoring a card — and seeing
    // `{championDistnce}` in the panel is a far better clue than seeing `NaN`.
    if (!isMetric(name)) return whole;
    return format(name, outcome[name], decimals);
  });
}

/** Walk the branches, pick the one that holds, and interpolate it. */
export function renderAfterword(afterword: Afterword, outcome: Outcome): string {
  if ('text' in afterword) return interpolate(afterword.text, outcome);
  return renderAfterword(
    evaluateCheck(afterword.when, outcome) ? afterword.then : afterword.otherwise,
    outcome,
  );
}

/* ---------------- for the tests, and only for the tests ---------------- */

/** Every metric a check reads, at any depth. */
export function metricsIn(check: Check): string[] {
  if ('all' in check) return check.all.flatMap(metricsIn);
  if ('any' in check) return check.any.flatMap(metricsIn);
  if ('not' in check) return metricsIn(check.not);
  return [check.metric];
}

/** Every `{placeholder}` name an afterword writes, at any depth, including unknown ones. */
export function placeholdersIn(afterword: Afterword): string[] {
  if ('text' in afterword) {
    return [...afterword.text.matchAll(PLACEHOLDER)].map((m) => m[1]!);
  }
  return [
    ...metricsIn(afterword.when),
    ...placeholdersIn(afterword.then),
    ...placeholdersIn(afterword.otherwise),
  ];
}

/** Every leaf string an afterword can produce, so a test can cover both branches of a card. */
export function branchesOf(afterword: Afterword): string[] {
  if ('text' in afterword) return [afterword.text];
  return [...branchesOf(afterword.then), ...branchesOf(afterword.otherwise)];
}
