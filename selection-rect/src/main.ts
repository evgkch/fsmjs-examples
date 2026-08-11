/**
 * Driving the machine from the browser — sections 6 and 9 of the write-up.
 *
 * What matters here is what is *absent*: **no handler checks the phase**.
 * `pointermove` always sends `move`, and in `ready` the schema defines no such
 * transition, so `dispatch` returns `false` and changes nothing. That is the
 * machine's partiality doing real work: the set of events acceptable right now
 * is held by the schema, not by a chain of `if`s in the view.
 */
import type { FsmState } from "@evgkch/fsmjs";
import { log, rules } from "@evgkch/fsmjs/debug";
import { handleAt, norm } from "./geometry.js";
import { inside, sel } from "./machine.js";
import type { Point, Rect, Sel, Spot } from "./types.js";

const area = document.getElementById("area")!;
const box = document.getElementById("box")!;
const rectOut = document.getElementById("rect")!;
const undoOut = document.getElementById("undo")!;
const logOut = document.getElementById("log")!;

/**
 * Pointer position relative to the drawing area, in whole pixels, with the area's own size
 * along for the ride — the box the selection may not leave.
 *
 * Rounding happens here, at the edge, rather than in the readout: `clientX` and the bounding
 * box are both fractional under page zoom or a HiDPI screen, and every coordinate downstream
 * — the context, the guards' tolerance, the box's CSS, the printed numbers — derives from
 * this one point. Round once on the way in and all of them agree; round only when printing
 * and the machine keeps a rectangle the readout never showed.
 *
 * Reading the size here also means a resized window needs no event of its own: the next
 * pointer event carries the new bounds, which is the only moment they can matter.
 */
function at(e: PointerEvent): Spot {
  const b = area.getBoundingClientRect();
  return {
    x: Math.round(e.clientX - b.left),
    y: Math.round(e.clientY - b.top),
    area: { w: Math.round(b.width), h: Math.round(b.height) },
  };
}

// ── input: events go straight to the machine, with no phase test ─────────────

area.addEventListener("pointerdown", (e) => {
  area.setPointerCapture(e.pointerId);
  sel.dispatch("down", at(e));
});
area.addEventListener("pointerup", () => sel.dispatch("up"));
// A pointer the browser takes away (touch interrupted, window blurred) never sends `up`,
// which would strand the machine mid-drag. `cancel` is already in the alphabet and every
// drag phase accepts it, so the stray case needs no new rule — only this line.
area.addEventListener("pointercancel", () => sel.dispatch("cancel"));
addEventListener("keydown", (e) => {
  if (e.key === "Escape") sel.dispatch("cancel");
  if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    undoDrag();
  }
});

// ── output: subscriptions to the machine's output letters ────────────────────

sel.rx.on("draw", ({ rect }) => paint(rect));
sel.rx.on("clear", () => {
  box.style.display = "none";
});

// ── the cursor: view and guards answer one question with one piece of code ───

/**
 * The cursor asks the same questions the guards do, with the same code — but it has to say
 * *which* phase it is asking about first: in `empty` there is no rectangle to be near. The
 * snapshot's `state` is the discriminant, so testing it is what puts `context`'s fields in
 * scope — the view admits the absence rather than reading a field that is not there.
 */
function cursor(at: { context: { rect: Rect } }, p: Point) {
  const g = handleAt(at.context.rect, p);
  return g ? `${g}-resize` : inside(at.context, p) ? "move" : "crosshair";
}

area.addEventListener("pointermove", (e) => {
  const p = at(e);
  sel.dispatch("move", p);
  const now = sel.state;
  if (now.type === "ready") area.style.cursor = cursor(now, p);
});

// ── undo by whole drags (section 9) ──────────────────────────────────────────
//
// `history` will not do: it records every `move`, so undo would crawl back a
// drag one pointer sample at a time. A condition inside `log`'s sink looks at
// the (source, target) pair of one transition and keeps only the step *into* a
// drag — one entry per operation, holding where the machine stood before it.

const DRAG = ["drawing", "moving", "resizing"];

/**
 * One undo entry: where the machine stood before the drag, and the log as it read then.
 *
 * The position is `t.source` itself — both halves of S = Q × V, a `State`, taken
 * straight off the transition. A bare rectangle was not enough: the first drag begins in
 * `empty`, and going back to it as `ready` left the page showing a 0×0 selection the
 * machine did not believe in.
 */
type Undone = { at: FsmState<Sel>; log: Line[] };
const undo: Undone[] = [];

log(
  sel,
  rules((line, t) => {
    if (DRAG.includes(t.target.type) && !DRAG.includes(t.source.type))
      undo.push({ at: t.source, log: entries.map((e) => ({ ...e })) });
    render(t.target);
    trace(line);
  }),
);

/**
 * Going back uses `restore`, which is not a transition: nothing is dispatched, no output
 * event fires, no `Transition` is published. That is what keeps undo off its own stack —
 * and it also means none of the code that normally paints the page runs, so undo restores
 * the view by hand, the log strip included.
 */
function undoDrag() {
  const back = undo.pop();
  if (!back) return;

  sel.restore(back.at);
  // What the `draw`/`clear` output events would have done, had this been a transition.
  if (back.at.type === "empty") box.style.display = "none";
  else paint(norm(back.at.context.rect));
  area.style.cursor = "crosshair";

  entries.splice(0, entries.length, ...back.log);
  paintLog();
  render(back.at);
}

// ── readout ──────────────────────────────────────────────────────────────────

function paint(r: Rect) {
  Object.assign(box.style, {
    display: "block",
    left: `${r.x0}px`,
    top: `${r.y0}px`,
    width: `${r.x1 - r.x0}px`,
    height: `${r.y1 - r.y0}px`,
  });
}

/**
 * The phase drives the page through one attribute: the chip strip lights up the
 * current node of Q, and the handles appear only once there is a rectangle to
 * grab. Both are plain CSS off `body[data-phase]` — the view never branches on
 * the phase in script.
 */
function render(at: FsmState<Sel>) {
  document.body.dataset.phase = at.type;
  // `empty` carries no rectangle, so there is none to print — and the readout says so
  // rather than showing the 0×0 one that used to stand in for it.
  if (at.type === "empty") rectOut.textContent = "—";
  else {
    const n = norm(at.context.rect);
    rectOut.textContent = `${n.x0},${n.y0} ${n.x1 - n.x0}×${n.y1 - n.y0}`;
  }
  undoOut.textContent = String(undo.length);
}

/**
 * The transition log, newest first, with runs folded.
 *
 * A drag is one transition repeated: `move` fires per pointer sample, so
 * `drawing → drawing` would push the interesting lines off the strip within a
 * second. Identical consecutive lines therefore collapse into one and carry a
 * repeat count instead.
 */
type Line = { line: string; count: number };

const LINES = 12;
const entries: Line[] = [];

function trace(line: string) {
  const head = entries[0];
  if (head?.line === line) head.count++;
  else entries.unshift({ line, count: 1 });

  entries.length = Math.min(entries.length, LINES);
  paintLog();
}

/** Kept apart from `trace` because undo rewrites the whole strip at once. */
function paintLog() {
  logOut.textContent = entries
    .map((e) => (e.count > 1 ? `${e.line} (×${e.count})` : e.line))
    .join("\n");
}

render(sel.state);
