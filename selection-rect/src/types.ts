import type { IEvent, IState, Merge } from "@evgkch/fsmjs";

/**
 * The machine's types — sections 2.1 and 3 of the example write-up.
 *
 * `Phase` is the control state (a node of the graph), `Σ` and `Λ` are the
 * input and output carriers, and `Sel` is the context — everything the graph
 * does not show.
 */

export type Point = { x: number; y: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Size = { w: number; h: number };

export type Phase = "empty" | "ready" | "drawing" | "moving" | "resizing";

/**
 * A pointer event's payload: where the pointer is, and the area it is in.
 *
 * The size rides along with the position because the selection may not leave the canvas, and
 * the operations that enforce that are pure functions of `(context, payload)` — they have no
 * other way to learn how big the canvas is. The view reads both off one
 * `getBoundingClientRect`, so carrying it costs nothing and a resized window needs no event
 * of its own: the next pointer event already states the new size.
 */
export type Spot = Point & { area: Size };

export type Σ = Merge<
  IEvent<"down" | "move", Spot> | IEvent<"up"> | IEvent<"cancel">
>;
export type Λ = Merge<IEvent<"draw", { rect: Rect }> | IEvent<"clear">>;

/** The grabbed handle: its name is a vertical half followed by a horizontal one. */
export type Handle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

/**
 * The context, per phase — `V` as a carrier: phase ↦ what that phase remembers.
 *
 * This is the shape the problem actually has, and writing it out says so. `empty` remembers
 * nothing: there is no rectangle, no grab point, no captured handle, and now no way to invent
 * them. A drag remembers where it started; only a resize remembers which handle is held.
 *
 * The earlier single `Sel` had every field in every phase, so `empty` needed a `blank` whose
 * every value was a fiction — a zero-sized rectangle standing in for the absence of one. That
 * fiction reached the screen once (a 0×0 selection after undo) and had to be patched in the
 * view. Here it is not patched, it is unwriteable.
 */
export type Sel = Merge<
  | IState<"empty">
  | IState<"ready", { rect: Rect }>
  | IState<"drawing" | "moving", Dragging>
  | IState<"resizing", Dragging & { handle: Handle }>
>;

/** What every drag remembers: where the pointer went down, and the rectangle as it stood. */
export type Dragging = { rect: Rect; from: Point; start: Rect };
