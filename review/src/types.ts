/**
 * The three carriers, and what each phase of a review carries.
 *
 * The submission is a different object in every phase: a fault list exists only in `blocked`,
 * signatures only from `review` on, a timestamp only in `shipped`. `Q` binds field to phase, and
 * that rules out the record-plus-status bug — a `shipped` document with an open fault list.
 */
import type { IEvent, IState, Merge } from "@evgkch/fsmjs";

/** What is under review: somebody's state-machine schema, as they typed it. */
export type Doc = { readonly name: string; readonly text: string };

/**
 * One thing wrong with a submission. A `blocker` is what the gate refuses on; a `caution` passes
 * and is shown to the reviewers. The library's two severities map onto the pair.
 */
export type Fault = {
  readonly rank: "blocker" | "caution";
  readonly where: string;
  readonly what: string;
};

/**
 * A sign-off: who, when, and the signature itself — ECDSA P-256 over the document text,
 * hex-encoded. The text cannot change while signatures are collected (no `write` rule in
 * `review`), so every signature is over the same text. Any edit produces a new text, which is
 * why every path out of `review` drops the signatures: they are bound to the old one.
 */
export type Sign = {
  readonly who: string;
  readonly at: number;
  readonly sig: string;
};

/**
 * An item that was answered: the round, the author, the text. Closed, not deleted — the record
 * stays on the ticket, and if a revision did not fix the problem, the next gate run enters the
 * same item again beside the old one.
 */
export type Closed = {
  readonly round: number;
  readonly by: string;
  readonly what: string;
};

/**
 * The part of the submission that survives every phase: the document, the round, the settled
 * items. A phase adds what only that phase has.
 */
export type Ticket = {
  readonly doc: Doc;
  /** How many times it has gone to the gate. 0 before the first submission. */
  readonly round: number;
  readonly closed: readonly Closed[];
};

export type Q = Merge<
  | IState<"draft", Ticket>
  // Sent, and waiting on the gate. The document cannot be edited from here — there is no `write`
  // rule in this phase, which is the whole of enforcing that.
  | IState<"checking", Ticket>
  | IState<"blocked", Ticket & { faults: readonly Fault[] }>
  | IState<
      "review",
      Ticket & { notes: readonly Fault[]; signs: readonly Sign[] }
    >
  | IState<"changes", Ticket & { asked: string; by: string }>
  | IState<"approved", Ticket & { signs: readonly Sign[] }>
  | IState<"shipped", Ticket & { signs: readonly Sign[]; at: number }>
>;

export type Σ = Merge<
  | IEvent<"write", string>
  | IEvent<"submit">
  // The gate answering, and the answer is the list of faults, whole. It is an event like any
  // other, which is what makes the wait a phase of the machine rather than a flag beside it.
  | IEvent<"checked", readonly Fault[]>
  | IEvent<"sign", { who: string; sig: string }>
  | IEvent<"reject", { who: string; why: string }>
  | IEvent<"ship">
  | IEvent<"withdraw">
>;

export type Λ = Merge<
  // Run the gate over this text. The machine does not validate anything itself: it says when
  // validation is due, and whoever is listening does it and dispatches `checked` back.
  | IEvent<"gate", { text: string }>
  // One line for the activity feed, which is the only thing the page has to render from scratch.
  | IEvent<"logged", { line: string }>
>;
