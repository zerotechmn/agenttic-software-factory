// Drizzle SQLite schema. The Architect defines tables here; developers do not edit it.
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
