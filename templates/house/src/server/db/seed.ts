import type { DB } from "./client.ts";

/** Insert demo data when the database is empty. Must be idempotent (never clobber user data). */
export function seed(_db: DB): void {}
