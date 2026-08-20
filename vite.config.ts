import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs: the same build serves from the root locally and from
  // /fsmjs/ on GitHub Pages, with no base path to pass in.
  base: "./",
  resolve: {
    // The library is linked from the folder above, and a linked package is
    // resolved from where it really lives — so anything that reached it by a
    // second path would be a second copy, with a second `TRANSITION` symbol,
    // and a listener on one would never hear the other. One copy, this one.
    dedupe: ["@evgkch/fsmjs"],
  },
  optimizeDeps: {
    // Prebundled, the inspector would carry a copy of the library inside the
    // bundle — the second copy the line above exists to prevent. Served as
    // source, its import resolves to the page's one copy.
    exclude: ["@evgkch/fsmjs-inspector"],
  },
  build: {
    // Vite does not look for pages on its own — every example is listed here.
    rollupOptions: {
      input: {
        index: "index.html",
        "selection-rect": "selection-rect/index.html",
        review: "review/index.html",
        form: "form/index.html",
      },
    },
  },
});
