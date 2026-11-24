import { SqliteClient } from "@effect/sql-sqlite-bun";
import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";

/** Explicit upgrade entry point; committed artifacts are applied by the next slice. */
const filename =
  process.env["OPENTEAM_DATABASE_PATH"] ??
  `${process.env["OPENTEAM_DATA_DIR"] ?? "./data"}/openteam.db`;
const program = Effect.gen(function* () {
  yield* Effect.logInfo(`OpenTeam upgrade target: ${filename}`);
});

BunRuntime.runMain(program.pipe(Effect.provide(SqliteClient.layer({ filename }))));
