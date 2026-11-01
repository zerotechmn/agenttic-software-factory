// FROZEN CONTRACT — shared by server and web. Only the Architect edits this file.
// Every entity and every API request/response is defined here as a zod schema + type.
import { z } from "zod";

export const API = {
  health: "/api/health",
} as const;

export const HealthResponse = z.object({
  ok: z.literal(true),
  product: z.string(),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Standard error body for every non-2xx API response. */
export const ApiError = z.object({ error: z.string(), details: z.unknown().optional() });
export type ApiError = z.infer<typeof ApiError>;
