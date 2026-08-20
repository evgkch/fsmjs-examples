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
import { history, log } from "@evgkch/fsmjs/debug";
import { FsmjsDesk, fromMachine } from "@evgkch/fsmjs-inspector/ui";
import { handleAt, norm } from "./geometry.js";
import { inside, sel } from "./machine.js";
import type { Point, Rect, Sel, Spot } from "./types.js";

const area = document.getElementById("area")!;
const box = document.getElementById("box")!;
const rectOut = document.getElementById("rect")!;
const undoOut = document.getElementById("undo")!;

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
// drag — one entry per operation.

const DRAG = ["drawing", "moving", "resizing"];

/** One undo entry: where in the record the machine stood before the drag. */
type Undone = { at: number };
const undo: Undone[] = [];

/**
 * Every state the machine has been in, recorded by the library.
 *
 * The undo below is per *drag* and this is per transition, so they are not two histories: this one
 * holds the states, and the stack holds which of them a drag began at. Going back by hand and
 * going back from a debugger then move the same machine through the same record, rather than two
 * things disagreeing about where it has been.
 *
 * It is the library's own recorder and nothing is wrapped around it: `history(sel)` subscribes,
 * and the machine it watches does not learn that it is being watched.
 */
const past = history(sel);

log(sel, (t) => {
  // `history` subscribed first, so its index already points at the state this transition
  // reached; the state the drag began at is the one before it.
  if (DRAG.includes(t.target.type) && !DRAG.includes(t.source.type))
    undo.push({ at: past.index - 1 });
  render(t.target);
});

/**
 * Wherever the machine is put back, the page draws where it now is.
 *
 * It is subscribed to the *recorder*, not to the machine, and that is the whole of it: `restore`
 * dispatches nothing, so no output event fires and no `Transition` is published, which is what
 * keeps undo off its own stack. The one thing that does say so is the recorder, and it says it
 * whoever asked — so anything else that walks this run is not a case this page has to know about.
 */
past.rx.on("moved", () => {
  const at = sel.state;
  // What the `draw`/`clear` output events would have done, had this been a transition.
  if (at.type === "empty") box.style.display = "none";
  else paint(norm(at.context.rect));
  area.style.cursor = "crosshair";
  render(at);
});

/** Back one whole drag: the record put back to where it began. */
function undoDrag() {
  const back = undo.pop();
  if (!back) return;
  past.jump(back.at);
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

// ── the machine, drawn ────────────────────────────────────────────────────────
// The inspector's widgets on the same `sel`: the desk wires each to one subject and focus and
// gives it a switch; the widgets hear the machine themselves.
const desk = new FsmjsDesk();
desk.wiring = { subject: fromMachine(sel, { history: past }) };
document.getElementById("board")!.append(desk);
for (const widget of document.querySelectorAll<HTMLElement>(
  "fsmjs-legend, fsmjs-diagram, fsmjs-history",
))
  desk.enroll(widget as Parameters<typeof desk.enroll>[0]);
