/**
 * The vocabulary of the form: three fields, the faults a reading of them yields, and the
 * carriers Q, Σ, Λ. The context belongs to the phase: an attempt on the wire carries its
 * number, a refusal carries the server's answer beside it, `sent` carries the receipt.
 */
import type { IEvent, IState, Merge } from "@evgkch/fsmjs";

export type Fields = {
  name: string;
  email: string;
  amount: string;
};

export type Field = keyof Fields;

/** One thing wrong with one field, said for the reader. */
export type Fault = { field: Field; say: string };

/** Which fields the reader has left at least once — a fault is shown only for those. */
export type Touched = Readonly<Record<Field, boolean>>;

/** The form as it is being filled: the fields, what is wrong right now, and what to say it for. */
export type Filling = {
  fields: Fields;
  faults: readonly Fault[];
  touched: Touched;
};

/** An attempt on the wire or refused: the same form and the attempt's number — its ticket. */
export type InFlight = Filling & { attempt: number };

/** The server refused this attempt: the reason beside the count. */
export type Refused = InFlight & { why: string };

/** The budget is spent: the form and the last reason; nothing left to count. */
export type Failed = Filling & { why: string };

export type Q = Merge<
  | IState<"editing", Filling>
  | IState<"sending", InFlight>
  | IState<"refused", Refused>
  | IState<"failed", Failed>
  | IState<"sent", { fields: Fields; receipt: string }>
>;

export type Σ = Merge<
  | IEvent<"input", { field: Field; value: string }>
  | IEvent<"leave", { field: Field }>
  | IEvent<"submit">
  | IEvent<"ok", { attempt: number; receipt: string }>
  | IEvent<"fail", { attempt: number; why: string }>
  | IEvent<"retry">
>;

export type Λ = IEvent<"send", { attempt: number; fields: Fields }>;
