/**
 * Orbit and scrub. Hand-rolled, for the same reason the fitness chart is.
 *
 * Three ships `OrbitControls` in `examples/jsm`, and it is 1,300 lines that handle touch
 * pinch, damping, pan limits, keyboard and auto-rotate. What this needs is drag to turn,
 * wheel to zoom, and a clamp at the poles — about forty lines, with no second import path to
 * keep bundled and typed. When the 3D view grows a reason to need the rest, take the library.
 *
 * Neither control owns a clock. The orbit mutates a plain state object that `scene.ts` reads
 * on its next render, and the scrubber reports a frame index to whoever asked. Invariant 1
 * is not negotiable because something has a camera now.
 */

import type { OrbitState } from './scene.ts';

/** Elevation stops just short of vertical: at the pole the azimuth becomes meaningless. */
const MAX_ELEVATION = Math.PI / 2 - 0.05;
const MIN_ELEVATION = -0.2;
const MIN_DISTANCE = 1.0;
const MAX_DISTANCE = 12;

export interface OrbitHandle {
  dispose(): void;
}

export function attachOrbit(
  canvas: HTMLCanvasElement,
  orbit: OrbitState,
  onChange: () => void,
): OrbitHandle {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const down = (e: PointerEvent): void => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };

  const move = (e: PointerEvent): void => {
    if (!dragging) return;
    orbit.azimuth += (e.clientX - lastX) * 0.008;
    orbit.elevation = Math.max(
      MIN_ELEVATION,
      Math.min(MAX_ELEVATION, orbit.elevation + (e.clientY - lastY) * 0.006),
    );
    lastX = e.clientX;
    lastY = e.clientY;
    onChange();
  };

  const up = (e: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };

  const wheel = (e: WheelEvent): void => {
    // Passive listeners cannot preventDefault, and without it the page scrolls while the
    // user is zooming the scene. Registered non-passive on purpose.
    e.preventDefault();
    orbit.distance = Math.max(
      MIN_DISTANCE,
      Math.min(MAX_DISTANCE, orbit.distance * (1 + Math.sign(e.deltaY) * 0.1)),
    );
    onChange();
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });

  return {
    dispose(): void {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    },
  };
}

/* ---------------- scrubber ---------------- */

export interface ScrubberHandlers {
  /** A frame was selected. Scrubbing implies pausing — a timeline that fights playback is useless. */
  onSeek(frame: number): void;
  onPlayToggle(playing: boolean): void;
}

export interface Scrubber {
  /** Point the scrubber at a recording of `frames` frames sampled at `hz`. */
  attach(frames: number, hz: number): void;
  /** Move the handle without firing `onSeek` — for playback driving the UI, not the reverse. */
  show(frame: number, playing: boolean): void;
  readonly playing: boolean;
}

export function createScrubber(host: HTMLElement, handlers: ScrubberHandlers): Scrubber {
  host.innerHTML = `
    <button id="sc-play" class="sc-play" title="Play or pause the replay">❚❚</button>
    <input id="sc-range" class="sc-range" type="range" min="0" max="0" step="1" value="0"
           aria-label="Replay position">
    <b class="sc-time" id="sc-time">0.00 s</b>`;

  const play = host.querySelector<HTMLButtonElement>('#sc-play')!;
  const range = host.querySelector<HTMLInputElement>('#sc-range')!;
  const time = host.querySelector<HTMLElement>('#sc-time')!;

  let hz = 60;
  let playing = true;

  range.addEventListener('input', () => {
    // Dragging the handle pauses. Anything else means the playhead runs away from the finger.
    if (playing) {
      playing = false;
      play.textContent = '▶';
      handlers.onPlayToggle(false);
    }
    handlers.onSeek(Number(range.value));
  });

  play.addEventListener('click', () => {
    playing = !playing;
    play.textContent = playing ? '❚❚' : '▶';
    handlers.onPlayToggle(playing);
  });

  return {
    attach(frames: number, sampleRate: number): void {
      hz = sampleRate;
      range.max = String(Math.max(0, frames - 1));
      range.value = '0';
      time.textContent = '0.00 s';
    },

    show(frame: number, isPlaying: boolean): void {
      range.value = String(frame);
      time.textContent = `${(frame / hz).toFixed(2)} s`;
      if (isPlaying !== playing) {
        playing = isPlaying;
        play.textContent = playing ? '❚❚' : '▶';
      }
    },

    get playing(): boolean {
      return playing;
    },
  };
}
