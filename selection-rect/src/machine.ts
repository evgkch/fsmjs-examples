/**
 * The machine — sections 4 and 5 of the example write-up.
 *
 * The schema comes first, because the schema *is* the description of the
 * machine; everything below it is the bodies of the functions the schema names.
 * The file reads top to bottom exactly once: which transitions exist, then how
 * each one is computed.
 *
 * That order is possible because the guards and the operations are declared
 * with `function`, and function declarations hoist. Written as `const` arrows
 * they would be reached before initialisation and throw on the TDZ.
 *
 * `with` builds the context of the phase being *entered*, which is why entering
 * `empty` takes none at all and entering a drag cannot forget what a drag
 * remembers. The word does not mean "update the context" but "the context to
 * arrive with", and the phase named by `to` decides its shape.
 */
import { StateMachine } from "@evgkch/fsmjs";
import { TOL, handleAt, norm, slideInto, within } from "./geometry.js";
import type {
  Dragging,
  Handle,
  Σ,
  Λ,
  Point,
  Rect,
  Sel,
  Spot,
} from "./types.js";

// ── the schema ──────────────────────────────────────────────────────────────
//
// The three rules on `ready` + `down` sort out the three places a press can
// land: a handle, the middle, empty space. Every cell ends in an unguarded
// rule, so `validate` reports no dead rule.
//
// Note what is gone: `next: () => blank`. Entering `empty` builds nothing,
// because `empty` carries nothing — there is no blank left to invent.

export const sel = new StateMachine<Sel, Σ, Λ>(
  {
    empty: { down: [{ to: "drawing", with: begin }] },
    ready: {
      down: [
        { to: "resizing", when: onHandle, with: grabHandle },
        { to: "moving", when: inside, with: grab },
        { to: "drawing", with: begin },
      ],
      cancel: [{ to: "empty", emit: "clear" }],
    },
    drawing: {
      move: [{ to: "drawing", with: stretch, emit: "draw", by: shot }],
      up: [
        { to: "empty", when: tiny, emit: "clear" },
        { to: "ready", with: settle, emit: "draw", by: shot },
      ],
      cancel: [{ to: "empty", emit: "clear" }],
    },
    moving: {
      move: [{ to: "moving", with: translate, emit: "draw", by: shot }],
      up: [{ to: "ready", with: settle, emit: "draw", by: shot }],
      cancel: [{ to: "ready", with: revert, emit: "draw", by: shot }],
    },
    resizing: {
      move: [{ to: "resizing", with: resize, emit: "draw", by: shot }],
      up: [{ to: "ready", with: settle, emit: "draw", by: shot }],
      cancel: [{ to: "ready", with: revert, emit: "draw", by: shot }],
    },
  },
  { type: "empty", context: undefined },
);

// ── guards: they read the context and the payload, and nothing else (§ 9.1) ──
//
// Each takes the context of the phase it is used in, so a guard physically cannot
// reach for a field that phase does not have.

export function onHandle(s: { rect: Rect }, p: Point) {
  return handleAt(s.rect, p) !== undefined;
}

export function inside(s: { rect: Rect }, p: Point) {
  const { x0, y0, x1, y1 } = norm(s.rect);
  return p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1;
}

export function tiny(s: Dragging) {
  const r = norm(s.rect);
  return r.x1 - r.x0 < TOL || r.y1 - r.y0 < TOL;
}

// ── operations: each returns a new object, none mutates (§ 9.3) ──────────────
//
// The selection stays inside the canvas, and that is enforced here rather than in the view:
// the context is what the rest of the program reads, so a rectangle that never leaves the
// area is a property of the machine, not of how it happens to be drawn. Two shapes of the
// same rule — a dragged *edge* stops at the border (`within` on the point), a dragged
// *rectangle* pins to it with its size intact (`slideInto`).

function begin(_s: unknown, p: Spot): Dragging {
  const q = within(p, p.area);
  const r = { x0: q.x, y0: q.y, x1: q.x, y1: q.y };
  return { rect: r, from: q, start: r };
}

function grab(s: { rect: Rect }, p: Spot): Dragging {
  return { rect: s.rect, from: { x: p.x, y: p.y }, start: s.rect };
}

function grabHandle(s: { rect: Rect }, p: Spot): Dragging & { handle: Handle } {
  return { ...grab(s, p), handle: handleAt(s.rect, p) ?? "se" };
}

function stretch(s: Dragging, p: Spot): Dragging {
  const q = within(p, p.area);
  return { ...s, rect: { ...s.start, x1: q.x, y1: q.y } };
}

function translate(s: Dragging, p: Spot): Dragging {
  const dx = p.x - s.from.x,
    dy = p.y - s.from.y;
  return {
    ...s,
    rect: slideInto(
      {
        x0: s.start.x0 + dx,
        y0: s.start.y0 + dy,
        x1: s.start.x1 + dx,
        y1: s.start.y1 + dy,
      },
      p.area,
    ),
  };
}

function resize(s: Dragging & { handle: Handle }, p: Spot) {
  const g = s.handle,
    b = norm(s.start),
    q = within(p, p.area);
  return {
    ...s,
    rect: {
      x0: g.includes("w") ? q.x : b.x0,
      y0: g.includes("n") ? q.y : b.y0,
      x1: g.includes("e") ? q.x : b.x1,
      y1: g.includes("s") ? q.y : b.y1,
    },
  };
}

/** Leaving a drag for `ready`: keep the rectangle, drop what only a drag needed. */
function settle(s: Dragging): { rect: Rect } {
  return { rect: s.rect };
}

/** `cancel` mid-drag: back to the rectangle as it stood when the drag began. */
function revert(s: Dragging): { rect: Rect } {
  return { rect: s.start };
}

/** The `draw` payload — built from the context *after* the move. */
function shot(s: { rect: Rect }) {
  return { rect: norm(s.rect) };
}
