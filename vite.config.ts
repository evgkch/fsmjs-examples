import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs: the same build serves from the root locally and from
  // /fsmjs/ on GitHub Pages, with no base path to pass in.
  base: "./",
  build: {
    // Vite does not look for pages on its own — every example is listed here.
    rollupOptions: {
      input: {
        index: "index.html",
        "selection-rect": "selection-rect/index.html",
      },
    },
  },
});
