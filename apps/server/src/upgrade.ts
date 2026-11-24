import { BunRuntime } from "@effect/platform-bun";
import { Effect, Logger } from "effect";
import { resolveDatabaseConfig } from "./config.ts";
import { runUpgrade } from "./operations/upgrade.ts";

const program = Effect.gen(function* () {
  const config = resolveDatabaseConfig();
  const result = yield* runUpgrade({ dataDir: config.dataDir, databasePath: config.databasePath });
  yield* Effect.logInfo("upgrade_complete", {
    applied: result.applied,
    alreadyCurrent: result.alreadyCurrent,
  });
}).pipe(
  Effect.tapError((error) =>
    Effect.logError("upgrade_failed", {
      message: error instanceof Error ? error.message : "The database upgrade failed.",
    }),
  ),
  Effect.provide(Logger.layer([Logger.withConsoleError(Logger.formatJson)])),
);

BunRuntime.runMain(program, { disableErrorReporting: true });
