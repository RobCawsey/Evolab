/**
 * The one place where world coordinates (metres, y-up) become canvas coordinates
 * (pixels, y-down). CLAUDE.md says this flip happens here and nowhere else.
 */

export interface Camera {
  /** Pixels per metre. */
  readonly scale: number;
  /** World-space point that sits at the canvas anchor. */
  readonly cx: number;
  readonly cy: number;
  /** Canvas-space anchor, in CSS pixels. */
  readonly ax: number;
  readonly ay: number;
}

export function fitCamera(widthPx: number, heightPx: number, focusX = 0): Camera {
  // Frame roughly 1.8 m of height and 4 m of width, so a 0.92 m biped fills a useful
  // fraction of the canvas without the ground line crowding the bottom edge.
  const scale = Math.min(heightPx / 1.8, widthPx / 4);
  // Track the robot once it walks past a comfortable margin, so a 12 m gait stays on
  // screen. The metre grid scrolls past, which is also how you see that it is moving.
  return { scale, cx: focusX, cy: 0, ax: widthPx * 0.5, ay: heightPx - Math.max(48, heightPx * 0.14) };
}

export function toScreenX(cam: Camera, worldX: number): number {
  return cam.ax + (worldX - cam.cx) * cam.scale;
}

export function toScreenY(cam: Camera, worldY: number): number {
  return cam.ay - (worldY - cam.cy) * cam.scale;
}
