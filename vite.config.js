import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Relative base: the built bundle works at the domain root, under a GitHub
// Pages project sub-path (/Quality-Vision/), or opened straight from disk.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
});
