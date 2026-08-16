/**
 * The pipeline itself.
 *
 * The schema comes first, because the schema *is* the description of the process. Read it once,
 * top to bottom, and you have read the whole policy: who may do what, from where, and what it
 * takes to get to the end. Everything under it is the bodies of the functions the schema names,
 * declared with `function` so they hoist and the file can be in that order.
 *
 * What a workflow written this way cannot do is the thing workflows written as a status column
 * always do. There is no `if (status === "checking") return;` anywhere in this example, and there
 * is no way to add one by accident: `write` is not a rule of `checking`, so a keystroke that
 * arrives while the gate is running is refused by the table rather than by somebody remembering
 * to check. The same goes for signing a draft, shipping something unapproved, and editing a
 * document that has already gone out — all four are absences in the schema, not code.
 *
 * `emit` is the other half. The machine never runs the gate and never writes to the page: it says
 * `gate` when validation is due and `logged` when something happened worth recording, and the app
 * around it does those things. So the pipeline can be read, tested and drawn without a DOM, and
 * the wait for CI is a phase of the machine rather than a promise held somewhere off to one side.
 */
import { StateMachine } from "@evgkch/fsmjs";
import type {
  Closed,
  Doc,
  Fault,
  Q,
  Report,
  Sign,
  Ticket,
  Σ,
  Λ,
} from "./types.js";

/** How many sign-offs it takes. Two, and never the same person twice — see `signed`. */
export const QUORUM = 2;

const START: Doc = {
  name: "turnstile.json",
  text: `{
  "locked": {
    "coin": [{ "to": ["open", "reset"], "emit": "opened" }],
    "push": [{ "to": "locked", "emit": "denied" }]
  },
  "open": {
    "push": [{ "to": "locked" }]
  }
}`,
};

// ── the schema ──────────────────────────────────────────────────────────────
//
// Two cells hold the whole of the interesting logic, and both are a list of guarded rules ending
// in an unguarded one — so `validate` finds no dead rule, and there is no state of the world the
// table has no answer for.
//
//   checking · checked   the gate answered: blocked, or into review
//   review   · sign      that signature was the last one needed, or it was not

export const flow = new StateMachine<Q, Σ, Λ>(
  {
    draft: {
      write: [{ to: ["draft", edited] }],
      submit: [{ to: ["checking", sent], emit: ["gate", text] }],
    },

    checking: {
      checked: [
        { when: clean, to: ["review", opened], emit: ["logged", passed] },
        { to: ["blocked", faulted], emit: ["logged", refused] },
      ],
    },

    // Nothing to do but fix it. Editing is what takes it back to a draft — there is no "unblock" —
    // and what the gate refused on is closed on the way out rather than dropped.
    blocked: {
      write: [{ to: ["draft", fixed] }],
    },

    review: {
      // Three rules, and the cell is the whole sign-off policy: the signature that completes the
      // quorum, one from somebody who has already given theirs, and any other. Guarded, guarded,
      // unguarded — so there is no arrangement of signers the table has no answer for, and
      // `validate` finds no rule behind an unguarded one.
      sign: [
        { when: last, to: ["approved", sealed], emit: ["logged", quorum] },
        // Nothing changes, and the machine says so by arriving where it was with the context it
        // had: `review` to `review` needs no operation, because the context it carries is already
        // the context the target wants.
        { when: already, to: "review", emit: ["logged", twice] },
        { to: ["review", countersigned], emit: ["logged", oneMore] },
      ],
      reject: [{ to: ["changes", asked], emit: ["logged", sentBack] }],
      // The author pulling it back out of review. Their own document, their own call.
      withdraw: [{ to: ["draft", restarted], emit: ["logged", pulled] }],
    },

    // The same shape one phase over: editing answers the request, and the request is closed
    // against the round it was raised in.
    changes: {
      write: [{ to: ["draft", addressed] }],
    },

    approved: {
      ship: [{ to: ["shipped", stamped], emit: ["logged", shipped] }],
      // Approved is not final. Somebody may still stop it before it goes out.
      reject: [{ to: ["changes", asked], emit: ["logged", sentBack] }],
    },

    // The end, and it says so by having no rules at all: `analyze` calls it terminal, and every
    // control on the page is offered by asking the machine rather than by asking the phase.
    shipped: {},
  },
  { type: "draft", context: { doc: START, round: 0, closed: [] } },
);

// ── guards ──────────────────────────────────────────────────────────────────

/** Did the gate find anything that blocks. Cautions do not — they go to the reviewers. */
function clean(_c: Ticket, report: Report): boolean {
  return !report.faults.some((f) => f.rank === "blocker");
}

/**
 * Is this the signature that completes the quorum.
 *
 * Asked of the context and the payload and nothing else, which is why it can be read on its own:
 * a second signature from somebody who has already signed does not complete anything, and this is
 * the one place that fact is written down.
 */
function last(c: { signs: readonly Sign[] }, who: string): boolean {
  return !signed(c.signs, who) && c.signs.length + 1 >= QUORUM;
}

function already(c: { signs: readonly Sign[] }, who: string): boolean {
  return signed(c.signs, who);
}

const signed = (signs: readonly Sign[], who: string) =>
  signs.some((s) => s.who === who);

// ── operations: each returns the context of the phase being entered ─────────

/**
 * Every one of these returns the context of the phase being *entered*, and every one of them
 * carries the ticket through unchanged unless it has a reason not to. That is the split worth
 * watching: `...c` is the submission moving on, and what is written beside it is what the new
 * phase adds. Nothing has to remember to copy the record forward, because forgetting it would be
 * the odd thing to write rather than the easy one.
 */

function edited(c: Ticket, text: string): Ticket {
  return { ...c, doc: { ...c.doc, text } };
}

/** Off to the gate, and this is the round it will answer about. */
function sent(c: Ticket): Ticket {
  return { ...c, round: c.round + 1 };
}

/**
 * The author pulling it back out of review: nothing was raised, so there is nothing to close.
 *
 * The ticket is rebuilt rather than passed along, and the three lines are the point. Returning the
 * context whole would typecheck — a `review` context *is* a `Ticket`, with two extra fields — and
 * would carry the signatures into the draft, where the type says they do not exist and the page
 * would never look for them. Naming what survives is what makes "temporary" mean anything.
 */
function restarted(c: Ticket): Ticket {
  return { doc: c.doc, round: c.round, closed: c.closed };
}

/**
 * Answering what the gate refused on.
 *
 * Every blocker of that round is closed as the revision goes in — closed, and kept. Whether the
 * revision really fixed it is not this function's opinion to have: the next `submit` runs the gate
 * again, and anything still wrong is raised again, in a later round, beside the entry that says it
 * was raised before. A pipeline that erased the first one could not show you that.
 */
function fixed(c: Ticket & { faults: readonly Fault[] }, text: string): Ticket {
  const settled: Closed[] = c.faults
    .filter((f) => f.rank === "blocker")
    .map((f) => ({
      round: c.round,
      by: "gate",
      what: `${f.where} — ${f.what}`,
    }));
  return {
    doc: { ...c.doc, text },
    round: c.round,
    closed: [...c.closed, ...settled],
  };
}

/** The same act one phase over: the reviewer's request is answered, and stays on the ticket. */
function addressed(
  c: Ticket & { asked: string; by: string },
  text: string,
): Ticket {
  return {
    doc: { ...c.doc, text },
    round: c.round,
    closed: [...c.closed, { round: c.round, by: c.by, what: c.asked }],
  };
}

function faulted(
  c: Ticket,
  report: Report,
): Ticket & { faults: readonly Fault[] } {
  return { ...c, faults: report.faults };
}

/** Into review carrying what the gate let through: the cautions, for a human to weigh. */
function opened(
  c: Ticket,
  report: Report,
): Ticket & { notes: readonly Fault[]; signs: readonly Sign[] } {
  return {
    ...c,
    notes: report.faults.filter((f) => f.rank === "caution"),
    signs: [],
  };
}

/** A signature that is neither the last nor a repeat — the guards above have ruled both out. */
function countersigned(
  c: Ticket & { notes: readonly Fault[]; signs: readonly Sign[] },
  who: string,
) {
  return { ...c, signs: [...c.signs, { who, at: Date.now() }] };
}

function sealed(
  c: Ticket & { signs: readonly Sign[] },
  who: string,
): Ticket & { signs: readonly Sign[] } {
  return { ...c, signs: [...c.signs, { who, at: Date.now() }] };
}

/** Raised, not yet answered: it lives in the phase until an edit closes it. */
function asked(
  c: Ticket,
  p: { who: string; why: string },
): Ticket & { asked: string; by: string } {
  return { ...c, asked: p.why, by: p.who };
}

function stamped(c: Ticket & { signs: readonly Sign[] }) {
  return { ...c, at: Date.now() };
}

// ── the payloads of what it emits ───────────────────────────────────────────

function text(c: Ticket) {
  return { text: c.doc.text };
}

const line = (s: string) => ({ line: s });

/* Each line names its round, because the feed is the one place the rounds are told apart. */

function passed(c: Ticket & { notes: readonly Fault[] }) {
  return line(
    c.notes.length
      ? `round ${c.round}: gate passed with ${c.notes.length} caution(s) — ${QUORUM} sign-offs needed`
      : `round ${c.round}: gate passed clean — ${QUORUM} sign-offs needed`,
  );
}

function refused(c: Ticket & { faults: readonly Fault[] }) {
  const blockers = c.faults.filter((f) => f.rank === "blocker").length;
  return line(`round ${c.round}: gate refused it — ${blockers} blocker(s)`);
}

function oneMore(c: { signs: readonly Sign[] }) {
  return line(`signed off — ${QUORUM - c.signs.length} to go`);
}

function twice(_c: unknown, who: string) {
  return line(`${who} has already signed this one`);
}

function quorum(c: { signs: readonly Sign[] }) {
  return line(`approved by ${c.signs.map((s) => s.who).join(" and ")}`);
}

function sentBack(c: Ticket & { asked: string; by: string }) {
  return line(`round ${c.round}: ${c.by} asked for changes — ${c.asked}`);
}

function pulled() {
  return line("withdrawn by the author");
}

function shipped(c: Ticket) {
  return line(
    `${c.doc.name} shipped after ${c.round} round(s), ${c.closed.length} item(s) settled`,
  );
}
