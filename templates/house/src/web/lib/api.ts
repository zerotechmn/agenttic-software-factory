import type { z } from "zod";

export class ApiRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Typed fetch: validates the response against the contract schema. */
export async function api<T extends z.ZodType>(schema: T, path: string, init?: RequestInit & { json?: unknown }): Promise<z.infer<T>> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, (body as { error?: string } | null)?.error ?? res.statusText);
  return schema.parse(body);
}
