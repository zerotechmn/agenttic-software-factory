import { Hono } from "hono";
import type { HealthResponse } from "../../shared/contracts.ts";
import { PRODUCT_NAME } from "../../shared/product.ts";

export const health = new Hono().get("/", (c) =>
  c.json<HealthResponse>({ ok: true, product: PRODUCT_NAME, time: new Date().toISOString() }),
);
