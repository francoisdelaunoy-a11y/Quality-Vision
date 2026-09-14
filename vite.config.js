import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base must match the GitHub Pages sub-path: https://<user>.github.io/Quality-Vision/
export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/Quality-Vision/" : "/",
  plugins: [react(), tailwindcss()],
});
