/**
 * The page: a queue of one submission, and the buttons that move it.
 *
 * Three things are worth watching for while reading this file, because all three are the point.
 *
 * The first is that no handler tests the phase. A button is enabled by asking the machine
 * `can(event)` — the same question the next `dispatch` would answer — so the set of things you may
 * do right now is held by the schema and read off it, never mirrored here. Delete a rule from the
 * table and the button goes grey; add one and it lights up. The question narrows by payload too:
 * once anna has signed, `can("sign", { who: "anna", … })` is false while the same question about
 * boris is still true, and the buttons diverge without any code about signers.
 *
 * The second is the wait. `submit` emits `gate`, this file runs the checks and dispatches
 * `checked` back, and in between the machine sits in `checking` — a phase, with no `write` rule in
 * it, which is what makes the document uneditable while CI has it. The waiting is in the machine.
 * Nothing here holds a promise, a flag, or a boolean called `busy`.
 *
 * The signature is real: ECDSA P-256 over the document text, computed here before the event is
 * dispatched — WebCrypto is asynchronous and the machine is not, so the signing happens in the
 * handler and the machine receives a finished signature.
 */
import { TRANSITION } from "@evgkch/fsmjs";
import { FsmjsDesk, fromMachine } from "@evgkch/fsmjs-inspector/ui";
import { QUORUM, flow } from "./machine.js";
import { gate } from "./gate.js";
import type { Closed, Fault } from "./types.js";

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const doc = el<HTMLTextAreaElement>("doc");
const rev = el<HTMLSelectElement>("rev");
const revOptions = [...rev.querySelectorAll("option")];
const why = el<HTMLInputElement>("why");
const phaseOut = el<HTMLElement>("phase");
const roundOut = el<HTMLElement>("round");
const faultsOut = el<HTMLUListElement>("faults");
const settledBox = el<HTMLElement>("settled");
const closedOut = el<HTMLUListElement>("closed");
const signsOut = el<HTMLElement>("signs");
const feed = el<HTMLOListElement>("feed");
const submit = el<HTMLButtonElement>("submit");
const reject = el<HTMLButtonElement>("reject");
const ship = el<HTMLButtonElement>("ship");
const withdraw = el<HTMLButtonElement>("withdraw");

/** Who may sign: one button per board member, the name in `data-sign`. */
const signs = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-sign]"),
].map((button) => [button.dataset["sign"]!, button] as const);

// ── the keys, and the signature ─────────────────────────────────────────────

/** One P-256 keypair per board member, generated on load. A real pipeline would look them up. */
const keys = new Map<string, CryptoKeyPair>();
for (const [who] of signs)
  keys.set(
    who,
    await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    ),
  );

/** The signature itself: ECDSA over the document text, hex-encoded. */
async function autograph(who: string, text: string): Promise<string> {
  const bytes = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.get(who)!.privateKey,
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── input: straight to the machine, with no phase test on the way ───────────

doc.addEventListener("input", () => flow.dispatch("write", doc.value));
submit.addEventListener("click", () => flow.dispatch("submit"));
ship.addEventListener("click", () => flow.dispatch("ship"));
withdraw.addEventListener("click", () => flow.dispatch("withdraw"));
// The signature is computed over the text as it stands; whether the machine still accepts the
// event after the await is the machine's answer, as everywhere else.
for (const [who, button] of signs)
  button.addEventListener("click", async () =>
    flow.dispatch("sign", {
      who,
      sig: await autograph(who, flow.state.context.doc.text),
    }),
  );

// The reason box is cleared only if the dispatch was accepted — the returned boolean says so.
reject.addEventListener("click", () => {
  const sent = flow.dispatch("reject", {
    who: rev.value,
    why: why.value.trim() || "no reason given",
  });
  if (sent) why.value = "";
});

// ── the gate, driven by what the machine emits ──────────────────────────────

// `setTimeout`, because a nested `dispatch` is forbidden; the 700 ms stand in for CI.
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

  // The text comes from the machine, and the box is read-only whenever `write` cannot fire —
  // the same `can` the buttons use. An edit the schema refused never shows.
  if (doc.value !== s.context.doc.text) doc.value = s.context.doc.text;
  doc.readOnly = !flow.can("write", doc.value);

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
    ? `${held.map((x) => `${x.who} ${x.sig.slice(0, 8)}…`).join(", ")} — ${held.length}/${QUORUM}`
    : `none yet — ${QUORUM} needed`;

  roundOut.textContent =
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
  for (const [who, button] of signs)
    button.disabled = !flow.can("sign", { who, sig: "" });
  // A signer is disabled inside the dropdown by the same question; if the selected reviewer is
  // closed, the selection moves to an open one.
  for (const option of revOptions)
    option.disabled = !flow.can("reject", { who: option.value, why: "" });
  const open = revOptions.find((o) => !o.disabled);
  if (rev.selectedOptions[0]?.disabled && open) rev.value = open.value;
  reject.disabled = !flow.can("reject", { who: rev.value, why: "" });
}

flow.rx.on(TRANSITION, paint);
paint();

// ── the machine, drawn ────────────────────────────────────────────────────────
// The inspector's widgets on the same `flow`: the desk wires each to one subject and focus and
// gives it a switch; the widgets hear the machine themselves.
const desk = new FsmjsDesk();
desk.wiring = { subject: fromMachine(flow) };
el<HTMLElement>("board").append(desk);
for (const widget of document.querySelectorAll<HTMLElement>(
  "fsmjs-legend, fsmjs-diagram, fsmjs-history",
))
  desk.enroll(widget as Parameters<typeof desk.enroll>[0]);
