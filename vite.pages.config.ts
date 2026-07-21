import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("./github-pages-src", import.meta.url));
const publicDir = fileURLToPath(new URL("./public", import.meta.url));
const outDir = fileURLToPath(new URL("./pages-dist", import.meta.url));

export default defineConfig({
  root,
  base: "/KingOfTokyo/",
  publicDir,
  plugins: [react()],
  build: { outDir, emptyOutDir: true },
});
