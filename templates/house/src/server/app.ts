import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { health } from "./routes/health.ts";

export const app = new Hono();

// Security baseline: standard headers on every response, request bodies capped at 1 MB.
app.use("*", secureHeaders());
app.use("/api/*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Payload too large" }, 413) }));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

// Route mounting — the Architect adds one line per router; developers implement the routers.
app.route("/api/health", health);
