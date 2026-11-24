import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Persistence schemas are owned by the server workspace. */
export const schemaVersion = sqliteTable("schema_version", {
  version: text("version").primaryKey(),
  artifactHash: text("artifact_hash").notNull(),
  appliedAt: text("applied_at").notNull(),
});
