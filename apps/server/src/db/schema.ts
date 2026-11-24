import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Persistence schemas are owned by the server workspace. */
export const schemaVersion = sqliteTable("schema_version", {
  version: text("version").primaryKey(),
  artifactHash: text("artifact_hash").notNull(),
  appliedAt: text("applied_at").notNull(),
});

export const events = sqliteTable("events", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  cursor: text("cursor").notNull().unique(),
  type: text("type").notNull(),
  occurredAt: text("occurred_at").notNull(),
  payloadJson: text("payload_json").notNull(),
});

export const foundationProbes = sqliteTable(
  "foundation_probes",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    message: text("message").notNull(),
    createdAt: text("created_at").notNull(),
    eventSeq: integer("event_seq")
      .notNull()
      .references(() => events.seq),
  },
  (table) => [
    check("foundation_probes_message_length", sql`length(${table.message}) between 1 and 200`),
    uniqueIndex("foundation_probes_event_seq_unique").on(table.eventSeq),
  ],
);

export const commandReceipts = sqliteTable(
  "command_receipts",
  {
    key: text("key").primaryKey(),
    command: text("command").notNull(),
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json").notNull(),
    responseStatus: integer("response_status").notNull(),
    eventSeq: integer("event_seq")
      .notNull()
      .references(() => events.seq),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("command_receipts_event_seq_unique").on(table.eventSeq)],
);
