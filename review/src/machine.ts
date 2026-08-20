/**
 * The pipeline. The schema comes first — it is the whole policy; the functions it names follow,
 * declared with `function` so they hoist.
 *
 * There is no `if (status === …)` anywhere: an action that is not allowed in a phase is a rule
 * that is absent from that phase's cell, and `dispatch` refuses it. The machine also runs no side
 * effects itself: it emits `gate` and `logged`, and the app around it acts on them — so the
 * pipeline can be read, tested and drawn without a DOM.
 */
import { StateMachine } from "@evgkch/fsmjs";
import type { Closed, Doc, Fault, Q, Sign, Ticket, Σ, Λ } from "./types.js";

/** How many sign-offs it takes. Two, of a board of three, and never the same person twice. */
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
// The guards differ by cell, on purpose.
//
//   checking · checked   guarded, then unguarded: the gate's answer has an outcome either way
//   review   · sign      guarded throughout: a repeat signature satisfies neither guard, so
//                        `dispatch` returns false and `can("sign", …)` is false with it —
//                        the page disables that signer's button from the same question
//   reject               guarded by `unsigned`: a request for changes from somebody whose
//                        signature stands would contradict it. The board is one larger than
//                        the quorum, so even in `approved` one reviewer can still reject
//
// `validate` finds no dead rule: a rule behind an unguarded one can never fire, and no cell
// has one.

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
      // Two rules: the signature that completes the quorum, and one that does not yet. There is
      // no rule for a repeat signature — it satisfies neither guard, and `dispatch` returns
      // false.
      sign: [
        { when: last, to: ["approved", sealed], emit: ["logged", quorum] },
        {
          when: unsigned,
          to: ["review", countersigned],
          emit: ["logged", oneMore],
        },
      ],
      reject: [
        { when: unsigned, to: ["changes", asked], emit: ["logged", sentBack] },
      ],
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
      // Approved is not final: the board member who did not sign may still stop it.
      reject: [
        { when: unsigned, to: ["changes", asked], emit: ["logged", sentBack] },
      ],
    },

    // The end, and it says so by having no rules at all: `analyze` calls it terminal, and every
    // control on the page is offered by asking the machine rather than by asking the phase.
    shipped: {},
  },
  { type: "draft", context: { doc: START, round: 0, closed: [] } },
);

// ── guards ──────────────────────────────────────────────────────────────────

/** Did the gate find anything that blocks. Cautions do not — they go to the reviewers. */
function clean(_c: Ticket, faults: readonly Fault[]): boolean {
  return !faults.some((f) => f.rank === "blocker");
}

/**
 * Is this the signature that completes the quorum. A repeat from somebody who has already signed
 * completes nothing, and this is the one place that fact is written down.
 */
function last(c: { signs: readonly Sign[] }, p: { who: string }): boolean {
  return !given(c.signs, p.who) && c.signs.length + 1 >= QUORUM;
}

/**
 * No standing signature from this person. On `sign` it admits a first signature; on `reject` it
 * admits a request for changes — one from a person whose signature stands would contradict it.
 * The guards of a cell run in order, so on `sign` the quorum case is already taken by `last`.
 */
function unsigned(c: { signs: readonly Sign[] }, p: { who: string }): boolean {
  return !given(c.signs, p.who);
}

const given = (signs: readonly Sign[], who: string) =>
  signs.some((s) => s.who === who);

// ── operations: each returns the context of the phase being entered ─────────
//
// `...c` carries the ticket through; what is written beside it is what the new phase adds.

function edited(c: Ticket, text: string): Ticket {
  return { ...c, doc: { ...c.doc, text } };
}

/** Off to the gate, and this is the round it will answer about. */
function sent(c: Ticket): Ticket {
  return { ...c, round: c.round + 1 };
}

/**
 * The author withdraws from review. Rebuilt, not spread: returning `c` whole would typecheck —
 * a `review` context *is* a `Ticket` with two extra fields — and would carry the signatures into
 * `draft`, whose type does not include them.
 */
function restarted(c: Ticket): Ticket {
  return { doc: c.doc, round: c.round, closed: c.closed };
}

/**
 * Answers what the gate refused on: every blocker of the round is closed into the record as the
 * revision goes in. Whether the revision fixed it, the next `submit` shows — anything still wrong
 * is entered again, beside the old record.
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
  faults: readonly Fault[],
): Ticket & { faults: readonly Fault[] } {
  return { ...c, faults };
}

/** Into review carrying what the gate let through: the cautions, for a human to weigh. */
function opened(
  c: Ticket,
  faults: readonly Fault[],
): Ticket & { notes: readonly Fault[]; signs: readonly Sign[] } {
  return {
    ...c,
    notes: faults.filter((f) => f.rank === "caution"),
    signs: [],
  };
}

/** A signature short of the quorum: the review context is kept, the list grows by one. */
function countersigned(
  c: Ticket & { notes: readonly Fault[]; signs: readonly Sign[] },
  p: { who: string; sig: string },
): Ticket & { notes: readonly Fault[]; signs: readonly Sign[] } {
  return {
    ...c,
    signs: [...c.signs, { who: p.who, at: Date.now(), sig: p.sig }],
  };
}

/**
 * The signature that completes the quorum, and the exit from review.
 *
 * Rebuilt, not spread, for the reason `restarted` gives: `notes` belongs to `review`, and the
 * `approved` context does not include it — a spread would carry it along anyway.
 */
function sealed(
  c: Ticket & { notes: readonly Fault[]; signs: readonly Sign[] },
  p: { who: string; sig: string },
): Ticket & { signs: readonly Sign[] } {
  return {
    doc: c.doc,
    round: c.round,
    closed: c.closed,
    signs: [...c.signs, { who: p.who, at: Date.now(), sig: p.sig }],
  };
}

/**
 * The request for changes and its author — the `changes` context.
 *
 * Also rebuilt: both source contexts include signatures, and the `changes` context does not.
 * The signatures are bound to the text under review anyway — see `Sign`.
 */
function asked(
  c: Ticket,
  p: { who: string; why: string },
): Ticket & { asked: string; by: string } {
  return {
    doc: c.doc,
    round: c.round,
    closed: c.closed,
    asked: p.why,
    by: p.who,
  };
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
