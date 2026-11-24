import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql";
import migrationSql from "../../drizzle/20261124085326_init/migration.sql" with { type: "text" };
import { ensureDatabaseDirectory, sqliteLayer } from "../db/sqlite.ts";

export const SCHEMA_VERSION = "0000";
export const SCHEMA_ARTIFACT_HASH = createHash("sha256").update(migrationSql).digest("hex");

const STATEMENT_BREAKPOINT = /^--> statement-breakpoint\s*$/gm;

export class UpgradeError extends Schema.TaggedError<UpgradeError>()("UpgradeError", {
  code: Schema.Literals(["schema_upgrade_failed", "schema_version_conflict"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export interface UpgradeOptions {
  readonly dataDir: string;
  readonly databasePath?: string | undefined;
}

export interface UpgradeResult {
  readonly applied: ReadonlyArray<string>;
  readonly alreadyCurrent: boolean;
}

interface SchemaVersionRow {
  readonly version: string;
  readonly artifact_hash: string;
}

export const runUpgrade = Effect.fnUntraced(function* (options: UpgradeOptions) {
  const filename = options.databasePath ?? `${options.dataDir}/openteam.db`;
  yield* ensureDatabaseDirectory(filename);

  return yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables = yield* sql<{ name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'schema_version'
        `;
        if (tables.length === 0) {
          for (const statement of migrationSql.split(STATEMENT_BREAKPOINT)) {
            if (statement.trim() !== "") {
              yield* sql.unsafe(statement);
            }
          }
          yield* sql`
            INSERT INTO schema_version (version, artifact_hash, applied_at)
            VALUES (${SCHEMA_VERSION}, ${SCHEMA_ARTIFACT_HASH}, ${new Date().toISOString()})
          `;
          return { applied: [SCHEMA_VERSION], alreadyCurrent: false };
        }

        const rows = yield* sql<SchemaVersionRow>`
          SELECT version, artifact_hash FROM schema_version
        `;
        const current = rows.find((row) => row.version === SCHEMA_VERSION);
        if (current !== undefined) {
          if (current.artifact_hash !== SCHEMA_ARTIFACT_HASH) {
            return yield* new UpgradeError({
              code: "schema_version_conflict",
              message:
                "The applied schema artifact differs from the version shipped with this server.",
            });
          }
          return { applied: [], alreadyCurrent: true };
        }

        return yield* new UpgradeError({
          code: "schema_version_conflict",
          message: "The database schema is not compatible with this server version.",
        });
      }),
    );
  }).pipe(
    Effect.provide(sqliteLayer(filename, true)),
    Effect.mapError(
      (cause) =>
        new UpgradeError({
          code: cause instanceof UpgradeError ? cause.code : "schema_upgrade_failed",
          message: cause instanceof UpgradeError ? cause.message : "The database upgrade failed.",
          cause,
        }),
    ),
  );
});
