import { defineConfig } from "vite";

// Proxy to a FORGE server on :4317 in dev, and in preview only when asked (FORGE_LIVE=1).
// A plain `npm start` must always replay: QA once tested against a live factory by accident.
const forge = { "/events": "http://127.0.0.1:4317", "/state": "http://127.0.0.1:4317", "/say": "http://127.0.0.1:4317", "/task": "http://127.0.0.1:4317" };

export default defineConfig(({ isPreview }) => ({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  test: { include: ["tests/**/*.test.ts"], environment: "happy-dom" },
  server: { port: 5199, proxy: isPreview && process.env.FORGE_LIVE !== "1" ? undefined : forge },
  preview: { proxy: process.env.FORGE_LIVE === "1" ? forge : undefined },
}));
