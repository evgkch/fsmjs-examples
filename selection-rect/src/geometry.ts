/**
 * Geometry — section 4.2 of the example write-up.
 *
 * Nothing here knows about the machine: these are pure functions over a
 * rectangle and a point. Both the schema's guards and the view (the cursor) use
 * them, so "where did the pointer land" is answered by one piece of code in
 * both places rather than two that can drift apart.
 */
import type { Handle, Point, Rect, Size } from "./types.js";

/** Handle grab tolerance, in pixels. */
export const TOL = 6;

/** A point pulled back inside the area. */
export function within(p: Point, a: Size): Point {
  return {
    x: Math.min(Math.max(p.x, 0), a.w),
    y: Math.min(Math.max(p.y, 0), a.h),
  };
}

/**
 * A rectangle slid back inside the area, its size kept — so it pins to the edge instead of
 * being squashed against it.
 *
 * This is the move case, and it is why clamping the pointer is not enough on its own: drag a
 * rectangle by its middle and the pointer stays in the canvas while the far corner leaves it.
 * A rectangle larger than the area pins to the top-left, the first branch winning on each axis.
 */
export function slideInto(r: Rect, a: Size): Rect {
  const n = norm(r);
  const dx = n.x0 < 0 ? -n.x0 : n.x1 > a.w ? a.w - n.x1 : 0;
  const dy = n.y0 < 0 ? -n.y0 : n.y1 > a.h ? a.h - n.y1 : 0;
  return dx === 0 && dy === 0
    ? r
    : { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy };
}

/** Normalise a rectangle so that `x0 ≤ x1` and `y0 ≤ y1`. */
export function norm(r: Rect): Rect {
  return {
    x0: Math.min(r.x0, r.x1),
    y0: Math.min(r.y0, r.y1),
    x1: Math.max(r.x0, r.x1),
    y1: Math.max(r.y0, r.y1),
  };
}

/**
 * The handle under the pointer, or `undefined` for none.
 *
 * The name is assembled from a vertical half and a horizontal one, so corners
 * fall out on their own — no need to enumerate all eight cases.
 */
export function handleAt(r: Rect, p: Point): Handle | undefined {
  const { x0, y0, x1, y1 } = norm(r);
  function near(a: number, b: number) {
    return Math.abs(a - b) <= TOL;
  }
  function span(v: number, a: number, b: number) {
    return v >= a - TOL && v <= b + TOL;
  }
  const v = near(p.y, y0) ? "n" : near(p.y, y1) ? "s" : "";
  const h = near(p.x, x0) ? "w" : near(p.x, x1) ? "e" : "";
  if (!v && !h) return;
  if (!span(p.x, x0, x1) || !span(p.y, y0, y1)) return;
  return (v + h) as Handle;
}
