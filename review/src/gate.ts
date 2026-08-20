/**
 * The automated gate: what CI would run before a human looks.
 *
 * The document is a state-machine schema, so the checks are the library's own — `validate` for
 * the findings, `analyze` for the shape. On top of them sit the house rules: what this
 * organisation will not merge. The two lists are kept apart — facts and policy.
 */
import { analyze, validate } from "@evgkch/fsmjs/analysis";
import { edges, nodes } from "@evgkch/fsmjs";
import type { Fault } from "./types.js";

/**
 * A schema as the text box hands one over: keyed by state, holding anything. Loose on purpose —
 * a validator's input may be nonsense. `object` instead would cost the state names: `keyof
 * object` is `never`.
 */
export type Graph = Record<string, unknown>;

/**
 * The document read as a graph, or the reason it cannot be. Exported: the page parses the same
 * document to draw it, so the check and the drawing use one reader.
 */
export function readGraph(text: string): Graph | string {
  let read: unknown;
  try {
    read = JSON.parse(text);
  } catch (e) {
    return (e as Error).message;
  }
  if (read === null || typeof read !== "object" || Array.isArray(read))
    return "a schema is an object keyed by state";
  if (Object.keys(read).length === 0) return "the schema names no states";
  return read as Graph;
}

/** The start state: the first one the schema names — the library's own readers' convention. */
export const startOf = (graph: Graph): string => Object.keys(graph)[0] ?? "";

/** A document that will not read is one fault — there is nothing to analyse. */
const unreadable = (what: string): Fault[] => [
  { rank: "blocker", where: "document", what },
];

/**
 * What the library says, in this pipeline's words: an error blocks, a warning goes to the
 * reviewers. The mapping is decided here, so the machine's guard asks one question.
 */
const found = (graph: Graph, start: string): Fault[] =>
  validate(graph, start)
    // A dead end is no finding: the library marks it as a warning, but a state with no way
    // out is usually the intended final one. The case where nothing at all can run is
    // policy's own blocker below.
    .filter((issue) => issue.kind !== "terminal")
    .map((issue) => ({
      rank: issue.severity === "error" ? "blocker" : "caution",
      where: issue.event ? `${issue.node} · ${String(issue.event)}` : issue.node,
      what: issue.message,
    }));

/**
 * The house rules — this organisation's, not the library's. Three: a schema with no way out of
 * any state, an upper-case state name, and a guard without a name. The last reads the serialized
 * form: a dump writes `?` where an anonymous guard was.
 */
const policy = (graph: Graph, start: string): Fault[] => {
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
        where: `${String(row.from)} · ${String(row.on)}`,
        what: "the guard has no name, so no diagram can say what it decides",
      });

  return out;
};

/** Run the gate over a submission: everything the library found, then everything policy adds. */
export function gate(text: string): readonly Fault[] {
  const graph = readGraph(text);
  if (typeof graph === "string") return unreadable(graph);
  const start = startOf(graph);
  return [...found(graph, start), ...policy(graph, start)];
}
