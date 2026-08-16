/**
 * The automated gate: what CI would run before a human is asked to look.
 *
 * The thing being reviewed here is a state-machine schema, so the checks are the library's own —
 * `validate` for the findings and `analyze` for the shape. Nothing is reimplemented: a pipeline
 * that keeps its own idea of "unreachable state" beside the tool's is a pipeline with two answers
 * to one question, and the day they disagree is the day nobody trusts either.
 *
 * On top of those sit the house rules, which is the part every real pipeline has and no library
 * ships: what *this* organisation will not merge. They are separated deliberately — one list is
 * facts about the schema, the other is policy, and policy is the half that changes.
 */
import { analyze, validate } from "@evgkch/fsmjs/analysis";
import { edges, nodes } from "@evgkch/fsmjs";
import type { Fault, Report } from "./types.js";

/**
 * A schema as a text box can hand one over: keyed by state, holding anything.
 *
 * The looseness is the honest type and not a shortcut. Every reader below is written for a graph
 * that may be nonsense — that is what a validator is — and each answers rather than throws. Saying
 * `object` instead costs the state names: `keyof object` is `never`, and `nodes` would come back
 * with nothing to check.
 */
type Schema = Record<string, unknown>;

/** A schema that will not parse is one fault and no report — there is nothing to analyse. */
const unreadable = (what: string): Report => ({
  faults: [{ rank: "blocker", where: "document", what }],
  size: { states: 0, rules: 0, reached: 0 },
});

/**
 * What the library says, in this pipeline's words.
 *
 * `validate`'s two severities are kept as they are and not reinterpreted: an error blocks, a
 * warning is something the reviewers should see and may accept. Deciding that here rather than in
 * the machine keeps the machine's guard down to one question — is anything blocking.
 */
const found = (graph: Schema, start: string): Fault[] =>
  validate(graph, start).map((issue) => ({
    rank: issue.severity === "error" ? "blocker" : "caution",
    where: issue.event ? `${issue.node} · ${issue.event}` : issue.node,
    what: issue.message,
  }));

/**
 * The house rules — this organisation's, not the library's.
 *
 * Three, and each one is a thing a team actually argues about once and then automates: a schema
 * nobody can leave, a name that will read badly in every diagram it ever appears in, and a rule
 * whose guard was never given a name. The last is the one worth the paragraph: a dump keeps an
 * operation's *name* where the function was, and `?` is what a nameless one leaves behind — so a
 * reviewer reading the schema six months later is told "guarded, somehow", which is the least
 * useful true statement a diagram can make.
 */
const policy = (graph: Schema, start: string): Fault[] => {
  const out: Fault[] = [];
  const facts = analyze(graph, start);

  if (facts.terminal.length === facts.nodes.length)
    out.push({
      rank: "blocker",
      where: "schema",
      what: "every state is a dead end — nothing here can run",
    });

  for (const q of nodes(graph))
    if (q !== q.toLowerCase())
      out.push({
        rank: "caution",
        where: q,
        what: "state names are lower case in this codebase",
      });

  for (const row of edges(graph))
    if (row.when === "?")
      out.push({
        rank: "caution",
        where: `${row.from} · ${row.on}`,
        what: "the guard has no name, so no diagram can say what it decides",
      });

  return out;
};

/**
 * Run the gate over a submission.
 *
 * Takes text, not a schema: what an author submits is a document, and "it is not valid JSON" is
 * the first thing a pipeline has to be able to say. The start state is the first one the schema
 * names — the same convention the library's own readers use.
 */
export function gate(text: string): Report {
  let read: unknown;
  try {
    read = JSON.parse(text);
  } catch (e) {
    return unreadable((e as Error).message);
  }
  if (read === null || typeof read !== "object" || Array.isArray(read))
    return unreadable("a schema is an object keyed by state");

  const graph = read as Schema;
  const start = Object.keys(graph)[0];
  if (start === undefined) return unreadable("the schema names no states");

  const facts = analyze(graph, start);
  return {
    faults: [...found(graph, start), ...policy(graph, start)],
    size: {
      states: facts.nodes.length,
      rules: edges(graph).length,
      reached: facts.reachable.length,
    },
  };
}
