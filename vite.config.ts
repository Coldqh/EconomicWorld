import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative assets make the same build work at / and at /<repository>/ on GitHub Pages.
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
