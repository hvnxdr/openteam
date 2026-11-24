import { createHash } from "node:crypto";
import { DateTime, Effect, Schema } from "effect";
import { SqlClient } from "effect/sql";
import initialMigrationSql from "../../drizzle/20261124085326_init/migration.sql" with { type: "text" };
import foundationMigrationSql from "../../drizzle/20261124092514_foundation_probes/migration.sql" with { type: "text" };
import { ensureDatabaseDirectory, sqliteLayer } from "../db/sqlite.ts";

const STATEMENT_BREAKPOINT = /^--> statement-breakpoint\s*$/gm;

function hashArtifact(sql: string) {
  return createHash("sha256").update(sql).digest("hex");
}

const SCHEMA_ARTIFACTS = [
  { version: "0000", sql: initialMigrationSql },
  { version: "0001", sql: foundationMigrationSql },
] as const;

export const SCHEMA_VERSION = SCHEMA_ARTIFACTS[1].version;
export const SCHEMA_ARTIFACT_HASH = hashArtifact(SCHEMA_ARTIFACTS[1].sql);

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
          const appliedAt = DateTime.formatIso(yield* DateTime.now);
          for (const artifact of SCHEMA_ARTIFACTS) {
            for (const statement of artifact.sql.split(STATEMENT_BREAKPOINT)) {
              if (statement.trim() !== "") {
                yield* sql.unsafe(statement);
              }
            }
          }
          for (const artifact of SCHEMA_ARTIFACTS) {
            yield* sql`
              INSERT INTO schema_version (version, artifact_hash, applied_at)
              VALUES (${artifact.version}, ${hashArtifact(artifact.sql)}, ${appliedAt})
            `;
          }
          return {
            applied: SCHEMA_ARTIFACTS.map((artifact) => artifact.version),
            alreadyCurrent: false,
          };
        }

        const rows = yield* sql<SchemaVersionRow>`
          SELECT version, artifact_hash FROM schema_version
        `;
        const applied = new Map(rows.map((row) => [row.version, row.artifact_hash]));
        for (const row of rows) {
          const artifact = SCHEMA_ARTIFACTS.find((candidate) => candidate.version === row.version);
          if (artifact === undefined || row.artifact_hash !== hashArtifact(artifact.sql)) {
            return yield* new UpgradeError({
              code: "schema_version_conflict",
              message:
                "The applied schema artifact differs from the version shipped with this server.",
            });
          }
        }

        const firstPending = SCHEMA_ARTIFACTS.findIndex(
          (artifact) => !applied.has(artifact.version),
        );
        if (firstPending === -1) {
          return { applied: [], alreadyCurrent: true };
        }
        if (
          SCHEMA_ARTIFACTS.some(
            (artifact, index) => index > firstPending && applied.has(artifact.version),
          )
        ) {
          return yield* new UpgradeError({
            code: "schema_version_conflict",
            message: "The database schema is not compatible with this server version.",
          });
        }

        const pending = SCHEMA_ARTIFACTS.slice(firstPending);
        const appliedAt = DateTime.formatIso(yield* DateTime.now);
        for (const artifact of pending) {
          for (const statement of artifact.sql.split(STATEMENT_BREAKPOINT)) {
            if (statement.trim() !== "") {
              yield* sql.unsafe(statement);
            }
          }
          yield* sql`
            INSERT INTO schema_version (version, artifact_hash, applied_at)
            VALUES (${artifact.version}, ${hashArtifact(artifact.sql)}, ${appliedAt})
          `;
        }
        return { applied: pending.map((artifact) => artifact.version), alreadyCurrent: false };
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
