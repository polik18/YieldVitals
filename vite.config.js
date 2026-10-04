import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

function copyClassicScripts() {
  return {
    name: "copy-classic-scripts",
    apply: "build",
    async closeBundle() {
      await mkdir(resolve("dist/js"), { recursive: true });
      await cp(resolve("js"), resolve("dist/js"), { recursive: true });
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [copyClassicScripts()],
  build: { outDir: "dist", emptyOutDir: true },
});
