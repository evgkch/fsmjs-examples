/**
 * The page: a queue of one submission, and the buttons that move it.
 *
 * Two things are worth watching for while reading this file, because both are the point.
 *
 * The first is that no handler tests the phase. A button is enabled by asking the machine
 * `can(event)` — the same question the next `dispatch` would answer — so the set of things you may
 * do right now is held by the schema and read off it, never mirrored here. Delete a rule from the
 * table and the button goes grey; add one and it lights up. There is no list of what is allowed
 * when, because there cannot be two.
 *
 * The second is the wait. `submit` emits `gate`, this file runs the checks and dispatches
 * `checked` back, and in between the machine sits in `checking` — a phase, with no `write` rule in
 * it, which is what makes the document uneditable while CI has it. The waiting is in the machine.
 * Nothing here holds a promise, a flag, or a boolean called `busy`.
 */
import { TRANSITION } from "@evgkch/fsmjs";
import { QUORUM, flow } from "./machine.js";
import { gate } from "./gate.js";
import type { Closed, Fault } from "./types.js";

/** The two people who may sign. A real one would ask a directory; this one has a guild of two. */
const BOARD = ["dana", "ravi"] as const;

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const doc = el<HTMLTextAreaElement>("doc");
const why = el<HTMLInputElement>("why");
const phaseOut = el<HTMLElement>("phase");
const sizeOut = el<HTMLElement>("size");
const faultsOut = el<HTMLUListElement>("faults");
const settledBox = el<HTMLElement>("settled");
const closedOut = el<HTMLUListElement>("closed");
const signsOut = el<HTMLElement>("signs");
const feed = el<HTMLOListElement>("feed");
const submit = el<HTMLButtonElement>("submit");
const reject = el<HTMLButtonElement>("reject");
const ship = el<HTMLButtonElement>("ship");
const withdraw = el<HTMLButtonElement>("withdraw");
const signs = BOARD.map(
  (who) => [who, el<HTMLButtonElement>(`sign-${who}`)] as const,
);

// ── input: straight to the machine, with no phase test on the way ───────────

doc.addEventListener("input", () => flow.dispatch("write", doc.value));
submit.addEventListener("click", () => flow.dispatch("submit"));
ship.addEventListener("click", () => flow.dispatch("ship"));
withdraw.addEventListener("click", () => flow.dispatch("withdraw"));
reject.addEventListener("click", () =>
  flow.dispatch("reject", {
    who: "dana",
    why: why.value.trim() || "no reason given",
  }),
);
for (const [who, button] of signs)
  button.addEventListener("click", () => flow.dispatch("sign", who));

// ── the gate, driven by what the machine emits ──────────────────────────────

/**
 * The pipeline's one side effect, and it is deferred twice over.
 *
 * Once because it must be: this listener runs *inside* the transition that emitted `gate`, and
 * the library refuses a dispatch from in there — a transition inside a transition would let the
 * inner commit be overwritten by the outer, so it throws rather than corrupt the run. Once
 * because CI takes a moment, and a phase that begins and ends in the same tick is a phase nobody
 * ever sees. The delay is a lie about the duration and the truth about the shape.
 */
flow.rx.on("gate", ({ text }) => {
  setTimeout(() => flow.dispatch("checked", gate(text)), 700);
});

/** Everything the machine says happened, in the order it happened. The page keeps no other log. */
flow.rx.on("logged", ({ line }) => {
  const row = document.createElement("li");
  row.textContent = line;
  feed.prepend(row);
});

// ── drawing ─────────────────────────────────────────────────────────────────

/** One row of two lines: what it is about, and what it says. Text is set, never interpolated. */
const item = (cls: string, where: string, what: string) => {
  const row = document.createElement("li");
  row.className = cls;
  const a = document.createElement("span");
  a.className = "where";
  a.textContent = where;
  const b = document.createElement("span");
  b.className = "what";
  b.textContent = what;
  row.append(a, b);
  return row;
};

const fault = (f: Fault) => item(f.rank, f.where, f.what);

/** An item that was raised and answered — kept, and marked as the round it belonged to. */
const closed = (c: Closed) =>
  item("done", `round ${c.round} · ${c.by}`, c.what);

/**
 * One function, run after every transition, that reads the machine and nothing else.
 *
 * The state is a discriminated union, so `s.type` narrows `s.context`: inside the `review` branch
 * the signatures are in scope and the fault list is not, because a document in review has no
 * fault list. The compiler is enforcing the same thing the schema is, which is the whole reason
 * the context belongs to the state.
 */
function paint(): void {
  const s = flow.state;
  document.body.dataset["phase"] = s.type;
  phaseOut.textContent = s.type;

  // The document is written by the machine and not by the box: an edit that never reached a
  // `write` rule — one typed while the gate had it — must not survive on screen.
  if (doc.value !== s.context.doc.text) doc.value = s.context.doc.text;

  // What is open right now, which is a fact about the phase and lasts as long as the phase does.
  faultsOut.replaceChildren(
    ...(s.type === "blocked"
      ? s.context.faults.map(fault)
      : s.type === "review"
        ? s.context.notes.map(fault)
        : s.type === "changes"
          ? [item("caution", s.context.by, s.context.asked)]
          : []),
  );

  // And what has been answered, which is a fact about the submission and outlives every phase of
  // it. Both come off the same context; only one of them is still open.
  closedOut.replaceChildren(...s.context.closed.map(closed));
  settledBox.hidden = s.context.closed.length === 0;

  const held =
    s.type === "review" || s.type === "approved" || s.type === "shipped"
      ? s.context.signs
      : [];
  signsOut.textContent = held.length
    ? `${held.map((x) => x.who).join(", ")} — ${held.length}/${QUORUM}`
    : `none yet — ${QUORUM} needed`;

  sizeOut.textContent =
    s.type === "checking"
      ? "running the gate…"
      : s.context.round === 0
        ? "not submitted yet"
        : `round ${s.context.round}`;

  // Every control, from one question. `can` is answerable without moving the machine, because a
  // guard is the only thing that decides and guards are pure.
  submit.disabled = !flow.can("submit");
  ship.disabled = !flow.can("ship");
  withdraw.disabled = !flow.can("withdraw");
  reject.disabled = !flow.can("reject", { who: "dana", why: "" });
  for (const [who, button] of signs) button.disabled = !flow.can("sign", who);
}

flow.rx.on(TRANSITION, paint);
paint();
