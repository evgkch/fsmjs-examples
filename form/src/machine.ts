/**
 * A form as a machine, sent over a flaky wire. Typing folds into the context and validation
 * is a pure reading of it. `submit` is a guard cascade: whole, the form goes to `sending`;
 * not whole, the same event stays in `editing` and marks every field. The send is a phase:
 * where there is no `input` rule the form is locked without a single flag.
 *
 * Every send carries the attempt's number — its ticket — and the answer brings the ticket
 * back. `fail` is a second cascade: the last allowed attempt gives the form up, an earlier
 * one is a refusal with a retry, and an answer whose ticket is not the one in flight matches
 * no rule at all — a duplicate or a straggler is dropped, and `dispatch` says so with `false`.
 *
 *   editing ── submit·whole ─▸ sending ── ok·mine ──▸ sent
 *   sending ── fail·mine ───▸ refused ── retry ────▸ sending (ticket advanced)
 *   sending ── fail·spent ──▸ failed
 *   refused, failed ── input ─▸ editing (the budget starts over)
 */
import { StateMachine } from "@evgkch/fsmjs";
import type {
  Failed,
  Fault,
  Field,
  Fields,
  Filling,
  InFlight,
  Q,
  Refused,
  Touched,
  Λ,
  Σ,
} from "./types.js";

/** Attempts the budget allows before the machine gives the form up. */
export const TRIES = 3;

/** What is wrong with the fields, read fresh on every keystroke. */
export function faultsOf(f: Fields): Fault[] {
  return [
    ...(f.name.trim() === ""
      ? [{ field: "name", say: "a name is required" } as const]
      : []),
    ...(/^\S+@\S+\.\S+$/.test(f.email)
      ? []
      : [{ field: "email", say: "not an address" } as const]),
    ...(/^\d+$/.test(f.amount) && +f.amount >= 1 && +f.amount <= 1000
      ? []
      : [{ field: "amount", say: "a number, 1 to 1000" } as const]),
  ];
}

/** One keystroke folded in: the field replaced, the faults re-read, the touches kept. */
function put(c: Filling, p: { field: Field; value: string }): Filling {
  const fields = { ...c.fields, [p.field]: p.value };
  return { fields, faults: faultsOf(fields), touched: c.touched };
}

/** The reader left the field: from now on its fault is said out loud. */
function mark(c: Filling, p: { field: Field }): Filling {
  return { ...c, touched: { ...c.touched, [p.field]: true } };
}

/** A submit on a faulty form says every fault out loud. */
function markAll(c: Filling): Filling {
  return { ...c, touched: { name: true, email: true, amount: true } };
}

/** Nothing is wrong: the one condition `submit` fires under. */
export function whole(c: Filling): boolean {
  return c.faults.length === 0;
}

/** The answer is to the attempt in flight — any other is dropped. */
function mine(c: InFlight, p: { attempt: number }): boolean {
  return p.attempt === c.attempt;
}

/** The answer is to the attempt in flight, and the budget allows no further one. */
function spent(c: InFlight, p: { attempt: number }): boolean {
  return p.attempt === c.attempt && c.attempt >= TRIES;
}

/** The first attempt: the ticket starts at 1. */
function first(c: Filling): InFlight {
  return { ...c, attempt: 1 };
}

/** The next attempt: the same form, the ticket advanced. */
function again(c: Refused): InFlight {
  return {
    fields: c.fields,
    faults: c.faults,
    touched: c.touched,
    attempt: c.attempt + 1,
  };
}

/** The refusal, remembered beside the attempt. */
function remember(c: InFlight, p: { attempt: number; why: string }): Refused {
  return { ...c, why: p.why };
}

/** The budget is spent: the count is dropped, the last reason stays. */
function giveUp(c: InFlight, p: { attempt: number; why: string }): Failed {
  return { fields: c.fields, faults: c.faults, touched: c.touched, why: p.why };
}

/** An accepted order: the fields and the server's receipt; nothing of the editing. */
function accepted(
  c: InFlight,
  p: { attempt: number; receipt: string },
): { fields: Fields; receipt: string } {
  return { fields: c.fields, receipt: p.receipt };
}

/** What `send` carries: the ticket and the fields. Reads the context after the move. */
function ticketed(c: InFlight): { attempt: number; fields: Fields } {
  return { attempt: c.attempt, fields: c.fields };
}

const EMPTY: Fields = { name: "", email: "", amount: "" };
const UNTOUCHED: Touched = { name: false, email: false, amount: false };

export const form = new StateMachine<Q, Σ, Λ>(
  {
    editing: {
      input: [{ to: ["editing", put] }],
      leave: [{ to: ["editing", mark] }],
      submit: [
        { when: whole, to: ["sending", first], emit: ["send", ticketed] },
        { to: ["editing", markAll] },
      ],
    },
    sending: {
      ok: [{ when: mine, to: ["sent", accepted] }],
      // The order matters: `spent` is the narrower case and stands first. An answer that
      // passes neither guard matches no rule — that is the drop.
      fail: [
        { when: spent, to: ["failed", giveUp] },
        { when: mine, to: ["refused", remember] },
      ],
    },
    refused: {
      // Touching any field is editing again; the refusal's reason stays behind.
      input: [{ to: ["editing", put] }],
      retry: [{ to: ["sending", again], emit: ["send", ticketed] }],
    },
    failed: {
      // Editing resets the budget: the next submit is a first attempt again.
      input: [{ to: ["editing", put] }],
    },
    sent: {},
  },
  {
    type: "editing",
    context: { fields: EMPTY, faults: faultsOf(EMPTY), touched: UNTOUCHED },
  },
);
