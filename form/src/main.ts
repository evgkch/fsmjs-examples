/**
 * The page: three fields, two buttons, and a machine that owns all of it.
 *
 * No handler tests the phase. A field is writable while `can("input", …)` says so — where
 * there is no `input` rule, the boxes lock themselves. `submit` is enabled by the same
 * question. The send is the `send` output event: the page answers it the way a flaky server
 * would — late, and refusals twice. The wire journal prints every message with the machine's
 * own verdict: `dispatch` returns `false` for an answer no rule matches, and that is a drop.
 */
import { TRANSITION } from "@evgkch/fsmjs";
import { FsmjsDesk, fromMachine } from "@evgkch/fsmjs-inspector/ui";
import { TRIES, form } from "./machine.js";
import type { Field } from "./types.js";

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const FIELDS: Field[] = ["name", "email", "amount"];
const boxes = new Map(FIELDS.map((f) => [f, el<HTMLInputElement>(f)]));
const faults = new Map(
  FIELDS.map((f) => [
    f,
    document.querySelector<HTMLElement>(`.fault[data-for="${f}"]`)!,
  ]),
);
const submit = el<HTMLButtonElement>("submit");
const retry = el<HTMLButtonElement>("retry");
const phaseOut = el<HTMLElement>("phase");
const countOut = el<HTMLElement>("count");
const attemptOut = el<HTMLElement>("attempt");
const verdict = el<HTMLElement>("verdict");
const wire = el<HTMLOListElement>("wire");

// ── input: straight to the machine ───────────────────────────────────────────

for (const [field, box] of boxes) {
  box.addEventListener("input", () =>
    form.dispatch("input", { field, value: box.value }),
  );
  // Leaving a field is an event too: from then on its fault is said out loud.
  box.addEventListener("blur", () => form.dispatch("leave", { field }));
}
submit.addEventListener("click", () => form.dispatch("submit"));
retry.addEventListener("click", () => form.dispatch("retry"));

// ── the server, played by the page ───────────────────────────────────────────

// One line per message on the wire; for an answer, the machine's own boolean says the rest.
function line(text: string): void {
  const li = document.createElement("li");
  li.textContent = text;
  wire.append(li);
  wire.scrollTop = wire.scrollHeight;
}

// `send` comes out of the machine with its ticket; the answer carries the ticket back.
// `setTimeout`, because a nested `dispatch` is forbidden; the delays stand in for the network.
form.rx.on("send", ({ attempt, fields }) => {
  line(`▸ send #${attempt}`);
  const deliver = (ms: number, label: string, answer: () => boolean) =>
    setTimeout(() => line(`◂ ${label} — ${answer() ? "taken" : "dropped"}`), ms);
  if (+fields.amount > 900) {
    const why = `amounts over 900 are refused — got ${fields.amount}`;
    // The wire is flaky: every refusal is delivered twice. The copy arrives when the machine
    // may already be on the next attempt — no rule matches a foreign ticket.
    deliver(700, `fail #${attempt}`, () =>
      form.dispatch("fail", { attempt, why }),
    );
    deliver(2100, `fail #${attempt} (copy)`, () =>
      form.dispatch("fail", { attempt, why }),
    );
  } else {
    deliver(700, `ok #${attempt}`, () =>
      form.dispatch("ok", { attempt, receipt: `ord-${fields.amount}-${attempt}` }),
    );
  }
});

// ── drawing: one function, run after every transition ────────────────────────

function paint(): void {
  const s = form.state;
  document.body.dataset["phase"] = s.type;
  phaseOut.textContent = s.type;

  const fields = s.context.fields;
  const wrong = s.type === "sent" ? [] : s.context.faults;
  const said = s.type === "sent" ? null : s.context.touched;
  for (const [field, box] of boxes) {
    if (box.value !== fields[field]) box.value = fields[field];
    // Writable exactly while the machine has a rule for it.
    box.readOnly = !form.can("input", { field, value: box.value });
    // A fault exists as soon as it is typed; it is said only for a field the reader has left.
    const fault = wrong.find((f) => f.field === field);
    const say = fault !== undefined && said !== null && said[field];
    faults.get(field)!.textContent = say ? fault.say : "";
    box.setAttribute("aria-invalid", say ? "true" : "false");
  }
  // The counter says only what the page says out loud: nothing has been asked of a pristine
  // form, so it shows nothing wrong.
  const spoken = wrong.filter((f) => said !== null && said[f.field]);
  const asked = said === null || Object.values(said).some(Boolean);
  countOut.textContent = !asked
    ? "—"
    : spoken.length === 0
      ? "none"
      : String(spoken.length);

  // The ticket, while there is one to show: in flight and after a refusal.
  attemptOut.textContent =
    s.type === "sending" || s.type === "refused"
      ? `${s.context.attempt} / ${TRIES}`
      : s.type === "failed"
        ? "spent"
        : "—";

  submit.disabled = !form.can("submit");
  retry.disabled = !form.can("retry");

  // One slot, always there: the page's height does not jump with the verdict.
  verdict.textContent =
    s.type === "refused"
      ? s.context.why
      : s.type === "failed"
        ? `gave up after ${TRIES} attempts — ${s.context.why}`
        : s.type === "sent"
          ? `sent — receipt ${s.context.receipt}`
          : "—";
  verdict.classList.toggle(
    "refusal",
    s.type === "refused" || s.type === "failed",
  );
}

form.rx.on(TRANSITION, paint);
paint();

// ── the machine, drawn ────────────────────────────────────────────────────────
// The inspector's widgets on the same `form`: the desk wires each to one subject and focus and
// gives it a switch; the widgets are subscribed to the machine themselves.
const desk = new FsmjsDesk();
desk.wiring = { subject: fromMachine(form) };
el<HTMLElement>("board").append(desk);
for (const widget of document.querySelectorAll<HTMLElement>(
  "fsmjs-legend, fsmjs-diagram, fsmjs-history",
))
  desk.enroll(widget as Parameters<typeof desk.enroll>[0]);
