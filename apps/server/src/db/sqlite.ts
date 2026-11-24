import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const SQLITE_BUSY_TIMEOUT = "5 seconds" as const;

export function ensureDatabaseDirectory(filename: string) {
  return Effect.promise(() => mkdir(dirname(filename), { recursive: true }));
}

export function sqliteLayer(filename: string, create: boolean) {
  const configure = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.unsafe("PRAGMA foreign_keys = ON");
    }),
  );
  return configure.pipe(
    Layer.provideMerge(
      SqliteClient.layer({
        filename,
        create,
        busyTimeout: SQLITE_BUSY_TIMEOUT,
      }),
    ),
  );
}
