import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.ts";
import { migrate } from "./migrate.ts";

const url = process.env.DATABASE_URL ?? "data/app.db";
if (url !== ":memory:") mkdirSync(dirname(url), { recursive: true });

export const sqlite = new Database(url);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
migrate(sqlite);

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
