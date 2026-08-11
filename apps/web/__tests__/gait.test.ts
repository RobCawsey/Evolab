import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Recording } from '@evolab/sim';
import { frameToX, plotRect, xToFrame } from '../src/render/gait/common.ts';

const gaitDir = fileURLToPath(new URL('../src/render/gait/', import.meta.url));
const sources = readdirSync(gaitDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ name: f, text: readFileSync(gaitDir + f, 'utf8') }));

function recording(frames: number, hz = 60): Recording {
  return {
    bodies: ['torso'], extents: new Float32Array([0.09, 0.18]), layers: ['body'],
    joints: ['hipL', 'hipR'], jointLayers: ['near', 'far'],
    hz, frames,
    pose: new Float32Array(frames * 3),
    anchors: new Float32Array(frames * 4),
    jointAngles: new Float32Array(frames * 2),
    contact: new Uint8Array(frames * 2),
    distance: new Float32Array(frames),
    torsoHeight: new Float32Array(frames),
    fell: false,
  };
}

describe('the gait panels re-run nothing', () => {
  it('never calls the simulator', () => {
    // The claim the whole slice rests on: every number these panels draw was already captured
    // by slice 9's recorder, so opening them costs no physics. The moment one of them calls
    // `evaluate`, watching a gait becomes as expensive as evolving one and the panels quietly
    // start competing with the search for the main thread.
    for (const { name, text } of sources) {
      expect(text, `${name} must not evaluate`).not.toMatch(/\bevaluate(Gait)?\s*\(/);
      expect(text, `${name} must not build a Sim`).not.toMatch(/new Sim\b/);
      expect(text, `${name} must not step physics`).not.toMatch(/\bstepControlled\b/);
    }
  });

  it('imports only what a recording can supply', () => {
    // A stricter version of the same rule, and the one that would catch a well-meaning
    // refactor: the only runtime imports from @evolab/sim are the two duty helpers.
    for (const { name, text } of sources) {
      const runtime = [...text.matchAll(/^import\s+(?!type)\{([^}]+)\}\s+from\s+'@evolab\/sim'/gm)]
        .flatMap((m) => m[1]!.split(',').map((s) => s.trim()))
        .filter((s) => s.length > 0 && !s.startsWith('type '));
      for (const symbol of runtime) {
        expect(['dutyFromRecording', 'dutyPerFoot'], `${name} imports ${symbol}`).toContain(symbol);
      }
    }
  });
});

describe('a leg is the same colour everywhere it is drawn', () => {
  it('keeps the footfall lanes and the 3D robot in step', () => {
    // Regression guard for exactly the bug this test was written after. The footfall diagram
    // identifies its two lanes by wearing the colours the robot wears; while they disagreed,
    // the right lane was violet and no leg anywhere was violet, so a reader had nothing to
    // connect the bar to and could only trust the text label. Duplicated constants in two
    // files with a comment asking politely for them to match is not a mechanism.
    const scene = readFileSync(
      fileURLToPath(new URL('../src/render/three/scene.ts', import.meta.url)), 'utf8',
    );
    const common = readFileSync(
      fileURLToPath(new URL('../src/render/gait/common.ts', import.meta.url)), 'utf8',
    );
    const hex = (text: string, key: 'near' | 'far') => {
      const m = text.match(new RegExp(`^\\s*${key}:\\s*(?:0x|')#?([0-9a-fA-F]{6})`, 'm'));
      expect(m, `no ${key} colour found`).not.toBeNull();
      return m![1]!.toLowerCase();
    };

    expect(hex(common, 'near')).toBe(hex(scene, 'near'));
    expect(hex(common, 'far')).toBe(hex(scene, 'far'));
    // And the two legs must be told apart at a glance, which a shade of the same hue is not.
    expect(hex(common, 'near')).not.toBe(hex(common, 'far'));
  });

  it('gives both legs equal visual weight in the diagram', () => {
    // A 3D scene may shade the far leg, because lighting already says "further away". A chart
    // may not: the two lanes carry equally important data, and dimming one says otherwise.
    // The first attempt at fixing the mismatch copied the scene's dim teal and did exactly
    // that — the right lane became noticeably harder to read than the left.
    const common = readFileSync(
      fileURLToPath(new URL('../src/render/gait/common.ts', import.meta.url)), 'utf8',
    );
    const lum = (key: 'near' | 'far') => {
      const m = common.match(new RegExp(`^\\s*${key}:\\s*'#([0-9a-fA-F]{6})'`, 'm'))![1]!;
      return [0, 2, 4].reduce((s, i) => s + parseInt(m.slice(i, i + 2), 16), 0);
    };
    const ratio = Math.max(lum('near'), lum('far')) / Math.min(lum('near'), lum('far'));
    expect(ratio).toBeLessThan(1.3);
  });
});

describe('the shared time axis', () => {
  it('maps the first and last frame to the ends of the plot', () => {
    const plot = plotRect(400, 100);
    const rec = recording(241);
    expect(frameToX(plot, rec, 0)).toBeCloseTo(plot.x, 10);
    expect(frameToX(plot, rec, 240)).toBeCloseTo(plot.x + plot.w, 10);
    expect(frameToX(plot, rec, 120)).toBeCloseTo(plot.x + plot.w / 2, 10);
  });

  it('round-trips a click back to the frame under the pointer', () => {
    // `xToFrame` is what click-to-seek uses and `frameToX` is what the playhead is drawn at.
    // If they disagreed, clicking a footfall bar would seek somewhere else — visible only as
    // the playhead landing next to the finger rather than under it.
    const plot = plotRect(520, 120);
    const rec = recording(241);
    for (const frame of [0, 1, 37, 120, 239, 240]) {
      expect(xToFrame(plot, rec, frameToX(plot, rec, frame))).toBe(frame);
    }
  });

  it('clamps rather than running off the ends', () => {
    const plot = plotRect(400, 100);
    const rec = recording(241);
    expect(xToFrame(plot, rec, plot.x - 500)).toBe(0);
    expect(xToFrame(plot, rec, plot.x + plot.w + 500)).toBe(240);
    expect(frameToX(plot, rec, -20)).toBeCloseTo(plot.x, 10);
    expect(frameToX(plot, rec, 9999)).toBeCloseTo(plot.x + plot.w, 10);
  });

  it('survives a single-frame recording without dividing by zero', () => {
    // A trial that fell on the first frame. The panels must draw something, not NaN — and a
    // click anywhere can only mean frame 0, because that is the only frame there is.
    const plot = plotRect(400, 100);
    const one = recording(1);
    expect(Number.isFinite(frameToX(plot, one, 0))).toBe(true);
    expect(xToFrame(plot, one, plot.x)).toBe(0);
    expect(xToFrame(plot, one, plot.x + plot.w)).toBe(0);
    expect(xToFrame(plot, one, 99999)).toBe(0);
  });

  it('gives both stacked panels the same mapping for the same width', () => {
    // Footfall and traces share a column so a reader can draw a vertical line down the two
    // with their eye. Equal widths must produce equal geometry, or the playheads separate.
    const rec = recording(241);
    const a = plotRect(600, 80);
    const b = plotRect(600, 96);
    expect(a.x).toBe(b.x);
    expect(a.w).toBe(b.w);
    expect(frameToX(a, rec, 143)).toBeCloseTo(frameToX(b, rec, 143), 12);
  });
});
