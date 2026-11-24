import { BunRuntime, BunServices } from "@effect/platform-bun";
import { createClient } from "@openteam/client";
import { resolveDatabaseConfig, resolveServerConfig, runServer } from "@openteam/server/runtime";
import { runUpgrade } from "@openteam/server/upgrade";
import { Command, Flag } from "effect/cli";
import { Console, Effect, Logger, Option } from "effect";

const baseUrl = Flag.String("base-url").pipe(
  Flag.withDefault("http://127.0.0.1:3000"),
  Flag.withDescription("OpenTeam server URL"),
);

const host = Flag.String("host").pipe(
  Flag.optional,
  Flag.withDescription("Host to bind (default: OPENTEAM_HOST or 127.0.0.1)"),
);
const port = Flag.Int("port").pipe(
  Flag.optional,
  Flag.withDescription("Port to bind (default: OPENTEAM_PORT or 3000)"),
);
const dataDir = Flag.String("data-dir").pipe(
  Flag.optional,
  Flag.withDescription("OpenTeam data directory (default: OPENTEAM_DATA_DIR)"),
);
const databasePath = Flag.String("database-path").pipe(
  Flag.optional,
  Flag.withDescription("SQLite database path (default: <data-dir>/openteam.db)"),
);

const health = Command.make("health", { baseUrl }, ({ baseUrl }) =>
  Effect.gen(function* () {
    const client = createClient({ baseUrl });
    const result = yield* Effect.tryPromise(() => client.health());
    yield* Console.log(JSON.stringify(result));
  }),
);

const serve = Command.make("serve", { host, port, dataDir, databasePath }, (options) =>
  Effect.gen(function* () {
    const config = resolveServerConfig({
      host: Option.getOrUndefined(options.host),
      port: Option.getOrUndefined(options.port),
      dataDir: Option.getOrUndefined(options.dataDir),
      databasePath: Option.getOrUndefined(options.databasePath),
    });
    yield* runServer(config);
  }),
);

const upgrade = Command.make("upgrade", { dataDir, databasePath }, (options) =>
  Effect.gen(function* () {
    const config = resolveDatabaseConfig({
      dataDir: Option.getOrUndefined(options.dataDir),
      databasePath: Option.getOrUndefined(options.databasePath),
    });
    const result = yield* runUpgrade({
      dataDir: config.dataDir,
      databasePath: config.databasePath,
    });
    yield* Effect.logInfo("upgrade_complete", {
      applied: result.applied,
      alreadyCurrent: result.alreadyCurrent,
    });
  }),
);

const cli = Command.make("openteam").pipe(Command.withSubcommands([health, serve, upgrade]));

cli.pipe(
  Command.run({ version: "0.0.0" }),
  Effect.tapError((error) =>
    Effect.logError("command_failed", {
      message: error instanceof Error ? error.message : "The OpenTeam command failed.",
    }),
  ),
  Effect.provide(Logger.layer([Logger.withConsoleError(Logger.formatJson)])),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
