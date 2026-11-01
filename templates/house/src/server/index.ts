import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { app } from "./app.ts";
import { db } from "./db/client.ts";
import { seed } from "./db/seed.ts";

seed(db);

const root = new Hono();
root.route("/", app);
root.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

if (process.env.NODE_ENV === "production" && existsSync("dist/web/index.html")) {
  const indexHtml = readFileSync("dist/web/index.html", "utf8");
  root.use("/*", serveStatic({ root: "./dist/web" }));
  // SPA fallback: unknown non-API paths render the app shell.
  root.get("*", (c) => c.html(indexHtml));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: root.fetch, port }, () => console.log(`server listening on http://localhost:${port}`));
