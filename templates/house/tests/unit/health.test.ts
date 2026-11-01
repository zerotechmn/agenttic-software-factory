import { describe, it, expect } from "vitest";
import { app } from "../../src/server/app.ts";
import { HealthResponse } from "../../src/shared/contracts.ts";

describe("GET /api/health", () => {
  it("returns ok with the product name", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body.ok).toBe(true);
  });
});
