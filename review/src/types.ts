/**
 * The three carriers, and what each phase of a review carries.
 *
 * A submission is not one object that grows fields as it moves. It is a different object in every
 * phase, and the phase decides which — a list of faults exists only where something is blocked, a
 * list of signatures only where somebody has signed, a timestamp only once it has shipped. That is
 * what `Q` is for: state ↦ context, so the field and the phase it belongs to cannot come apart.
 *
 * Which is worth saying twice for a review pipeline in particular. The bug this shape rules out —
 * a document that is `shipped` and still has an open fault list, or `blocked` with a signature on
 * it — is the exact bug a workflow written as one record and a status string keeps having.
 */
import type { IEvent, IState, Merge } from "@evgkch/fsmjs";

/** What is under review: somebody's state-machine schema, as they typed it. */
export type Doc = { readonly name: string; readonly text: string };

/**
 * One thing wrong with a submission.
 *
 * `validate` finds most of them and `analyze` the rest; a `blocker` is what the gate refuses on,
 * a `caution` is what it lets through and the reviewers are told about. The library's own two
 * severities map onto the pair, and the house rules below add to both.
 */
export type Fault = {
  readonly rank: "blocker" | "caution";
  readonly where: string;
  readonly what: string;
};

/** What the gate answered, whole — the machine reads it and decides which way to go. */
export type Report = {
  readonly faults: readonly Fault[];
  /** States, rules, and how many of the states a run can actually get to. */
  readonly size: { states: number; rules: number; reached: number };
};

/** A sign-off: who, and when they gave it. */
export type Sign = { readonly who: string; readonly at: number };

/**
 * Something that was raised against the submission and has been answered.
 *
 * Raising it is a phase — `blocked` while the gate is refusing, `changes` while a reviewer is
 * waiting — and a phase ends. What must not end with it is the record: a review that forgets what
 * was asked as soon as somebody addresses it cannot tell you why the schema looks the way it does,
 * and the fourth round of it is the same argument as the first with nobody able to prove it.
 *
 * So an item is *closed*, not deleted. It keeps the round it was raised in and who raised it, and
 * it stays on the ticket for the rest of the ticket's life. Answered is not the same as never
 * asked; if the revision did not really fix it, the next round raises it again, beside the old one.
 */
export type Closed = {
  readonly round: number;
  readonly by: string;
  readonly what: string;
};

/**
 * The submission itself — the part that survives every phase.
 *
 * A phase adds what only that phase has: a fault list while blocked, signatures while in review, a
 * timestamp once shipped. Underneath all of them is this, unchanged: the document, which round it
 * is on, and everything that has been settled about it. Splitting the two is the whole point of a
 * context that belongs to the state — what is carried through is written once, here, and what is
 * temporary cannot outlive the phase that owns it.
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
  // The gate answering. It is an event like any other, which is what makes the wait a phase of
  // the machine rather than a flag beside it.
  | IEvent<"checked", Report>
  | IEvent<"sign", string>
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
