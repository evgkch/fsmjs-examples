// The examples, pressed: each page runs in a DOM, its machine is driven with real payloads, and
// every widget is checked against the machine after every move. Any uncaught error fails the
// run. `npm test`; exits 1 on the first count that disagrees.
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const { Window } = await import(`${root}/node_modules/happy-dom/lib/index.js`);
const { createServer } = await import(
  `${root}/node_modules/vite/dist/node/index.js`
);

let failed = 0;
const eq = (name, got, want) => {
  const ok = Object.is(got, want);
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}: ${String(got)}${ok ? "" : ` (want ${String(want)})`}`,
  );
};
const tick = () => new Promise((r) => setTimeout(r, 60));

/** One page in a DOM: its window, and the errors nothing caught. */
async function raise(page) {
  const win = new Window({ url: `http://localhost/${page}/` });
  const html = fs
    .readFileSync(`${root}/${page}/index.html`, "utf8")
    .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, "");
  win.document.write(html);
  const caught = [];
  win.addEventListener("error", (e) => caught.push(e.message ?? String(e)));
  for (const k of [
    "window",
    "document",
    "customElements",
    "HTMLElement",
    "SVGElement",
    "ResizeObserver",
    "getComputedStyle",
    "CSSStyleSheet",
    "requestAnimationFrame",
    "location",
    "navigator",
  ]) {
    try {
      Object.defineProperty(globalThis, k, {
        value: win[k] ?? win.window[k],
        configurable: true,
      });
    } catch {}
  }
  for (const k of ["addEventListener", "removeEventListener", "dispatchEvent"])
    Object.defineProperty(globalThis, k, {
      configurable: true,
      value: win[k].bind(win),
    });
  Object.defineProperty(globalThis, "Option", {
    configurable: true,
    value: function (text, value) {
      const o = win.document.createElement("option");
      if (text !== undefined) o.textContent = String(text);
      if (value !== undefined) o.value = String(value);
      return o;
    },
  });
  const trap = (e) => caught.push(String(e?.message ?? e));
  process.on("uncaughtException", trap);
  process.on("unhandledRejection", trap);
  const server = await createServer({
    root,
    logLevel: "error",
    server: { middlewareMode: true },
    ssr: {
      noExternal: [
        "@evgkch/fsmjs-inspector",
        "@evgkch/fsmjs",
        "@evgkch/channeljs",
      ],
    },
  });
  const done = async () => {
    process.off("uncaughtException", trap);
    process.off("unhandledRejection", trap);
    await server.close();
  };
  return { win, server, caught, done };
}

const q = (el, sel) => el.shadowRoot.querySelectorAll(sel).length;
const here = (el) =>
  el.shadowRoot.querySelector(".word.here, g.chip.here text")?.textContent;

// ── selection-rect ────────────────────────────────────────────────────────────
{
  console.log("— selection-rect —");
  const { win, server, caught, done } = await raise("selection-rect");
  try {
    await server.ssrLoadModule("/selection-rect/src/main.ts");
    const { sel } = await server.ssrLoadModule(
      "/selection-rect/src/machine.ts",
    );
    await tick();

    const desk = win.document.querySelector("fsmjs-desk");
    const leg = win.document.querySelector("fsmjs-legend");
    const dia = win.document.querySelector("fsmjs-diagram");
    const hist = win.document.querySelector("fsmjs-history");
    eq("desk switches", q(desk, "label"), 3);
    eq("legend words", q(leg, ".word"), 5);
    eq("standing at", here(leg), "empty");
    eq("open arcs at empty", q(dia, "g.arc.can"), 1);
    eq("dim arcs at empty", q(dia, "g.arc.dim"), 14);
    const caps = [...dia.shadowRoot.querySelectorAll(".caps text")].map(
      (c) => c.textContent,
    );
    const downs = caps.filter((c) => c.startsWith("down"));
    eq("three downs, told apart by their guards", new Set(downs).size, 3);
    eq(
      "a guard rides the label",
      downs.some((c) => c.includes("· onHandle")),
      true,
    );

    // A whole drag, with the payloads the page would build.
    const at = (x, y) => ({ x, y, area: { w: 400, h: 300 } });
    sel.dispatch("down", at(10, 10));
    await tick();
    eq("drawing — legend follows", here(leg), "drawing");
    eq("drawing — diagram follows", here(dia), "drawing");
    eq("the taken arrow runs its dashes", q(dia, "g.arc.took"), 1);
    sel.dispatch("move", at(40, 40));
    sel.dispatch("move", at(80, 60));
    await tick();
    eq("the self-loop runs while dragging", q(dia, "g.arc.took"), 1);
    sel.dispatch("up");
    await tick();
    eq("ready — legend follows", here(leg), "ready");
    eq("ready — diagram follows", here(dia), "ready");
    eq("the run is on the board", q(hist, ".step") > 0, true);
    eq(
      "the readout shows the rectangle",
      /×/.test(win.document.getElementById("rect").textContent),
      true,
    );

    // Undo one whole drag, from the page's own key.
    win.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        bubbles: true,
      }),
    );
    await tick();
    eq("undo — legend back at", here(leg), "empty");
    eq("undo — diagram back at", here(dia), "empty");
    eq("undo — no arrow still running", q(dia, "g.arc.took"), 0);

    eq("uncaught errors", caught.length, 0);
    if (caught.length) console.log("  caught:", caught.slice(0, 3));
  } catch (e) {
    failed++;
    console.log("FAIL  the page did not load:", e.message);
  } finally {
    await done();
  }
}

// ── review ────────────────────────────────────────────────────────────────────
{
  console.log("— review —");
  const { win, server, caught, done } = await raise("review");
  try {
    await server.ssrLoadModule("/review/src/main.ts");
    const { flow } = await server.ssrLoadModule("/review/src/machine.ts");
    await tick();

    const leg = win.document.querySelector("fsmjs-legend");
    const dia = win.document.querySelector("fsmjs-diagram");
    const hist = win.document.querySelector("fsmjs-history");
    eq("legend words", q(leg, ".word"), 7);
    eq("standing at", here(leg), "draft");

    flow.dispatch("write", { text: "FROM a ON go TO b\nFROM b ON back TO a" });
    await tick();
    eq("write — a step on the board", q(hist, ".step"), 1);
    eq("write — the taken arrow runs", q(dia, "g.arc.took"), 1);
    flow.dispatch("submit");
    await tick();
    eq("checking — legend follows", here(leg), "checking");
    await new Promise((r) => setTimeout(r, 900));
    eq("the gate answered — legend follows", here(leg), "blocked");
    eq("the diagram stands with it", here(dia), "blocked");
    eq("three steps on the board", q(hist, ".step"), 3);

    eq("uncaught errors", caught.length, 0);
    if (caught.length) console.log("  caught:", caught.slice(0, 3));
  } catch (e) {
    failed++;
    console.log("FAIL  the page did not load:", e.message);
  } finally {
    await done();
  }
}

// ── form ──────────────────────────────────────────────────────────────────────
{
  console.log("— form —");
  const { win, server, caught, done } = await raise("form");
  try {
    await server.ssrLoadModule("/form/src/main.ts");
    const { form } = await server.ssrLoadModule("/form/src/machine.ts");
    await tick();

    const leg = win.document.querySelector("fsmjs-legend");
    const dia = win.document.querySelector("fsmjs-diagram");
    const hist = win.document.querySelector("fsmjs-history");
    eq("legend words", q(leg, ".word"), 5);
    eq("standing at", here(leg), "editing");
    const spoken = () =>
      [...win.document.querySelectorAll(".fault")].filter(
        (f) => f.textContent !== "",
      ).length;
    eq("faults exist but are not said yet", spoken(), 0);
    eq(
      "the counter says nothing of a pristine form",
      win.document.getElementById("count").textContent,
      "—",
    );
    win.document.getElementById("name").dispatchEvent(new win.Event("blur"));
    await tick();
    eq("a left field says its fault", spoken(), 1);
    form.dispatch("submit");
    await tick();
    eq("a faulty submit stays in editing", here(leg), "editing");
    eq("and says every fault out loud", spoken(), 3);
    eq("the attempt is a step on the board", q(hist, ".step"), 2);

    const type = (field, value) => form.dispatch("input", { field, value });
    type("name", "anna");
    type("email", "anna@x.dev");
    type("amount", "950");
    await tick();
    eq(
      "faults gone as typed",
      win.document.getElementById("count").textContent,
      "none",
    );
    form.dispatch("submit");
    await tick();
    eq("sending — legend follows", here(leg), "sending");
    eq(
      "sending — the fields are locked",
      form.can("input", { field: "name", value: "x" }),
      false,
    );
    eq(
      "the wire logs the send",
      /send #1/.test(win.document.getElementById("wire").textContent),
      true,
    );
    await new Promise((r) => setTimeout(r, 900));
    eq("over 900 — refused", here(leg), "refused");
    eq(
      "the attempt is counted",
      win.document.getElementById("attempt").textContent,
      "1 / 3",
    );
    eq(
      "the reason is on the page",
      /900/.test(win.document.getElementById("verdict").textContent),
      true,
    );
    type("amount", "300");
    await tick();
    eq("touching a field is editing again", here(leg), "editing");
    form.dispatch("submit");
    await new Promise((r) => setTimeout(r, 900));
    eq("300 — sent", here(leg), "sent");
    eq("the diagram stands with it", here(dia), "sent");
    eq("the run is on the board", q(hist, ".step") > 0, true);
    const caps = [...dia.shadowRoot.querySelectorAll(".caps text")].map(
      (c) => c.textContent,
    );
    eq(
      "the guard rides the submit label",
      caps.some((c) => c.includes("submit · whole")),
      true,
    );
    eq(
      "the receipt is on the page",
      /ord-300-1/.test(win.document.getElementById("verdict").textContent),
      true,
    );

    eq("uncaught errors", caught.length, 0);
    if (caught.length) console.log("  caught:", caught.slice(0, 3));
  } catch (e) {
    failed++;
    console.log("FAIL  the page did not load:", e.message);
  } finally {
    await done();
  }
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
