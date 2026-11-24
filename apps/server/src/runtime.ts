import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Logger } from "effect";

import { resolveServerConfig, type ServerConfig, type ServerConfigOverrides } from "./config.ts";
import { makeHttpServerLayer, SchemaCompatibilityError } from "./http.ts";

export { resolveDatabaseConfig, resolveServerConfig } from "./config.ts";

export function runServer(config: ServerConfig) {
  return Layer.launch(
    makeHttpServerLayer(config, BunHttpServer.layer({ hostname: config.host, port: config.port })),
  );
}

export function serverProgram(overrides: ServerConfigOverrides = {}) {
  return Effect.gen(function* () {
    const config = yield* Effect.try({
      try: () => resolveServerConfig(overrides),
      catch: (cause) => new Error("Invalid OpenTeam server configuration", { cause }),
    });
    yield* runServer(config);
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError("server_start_failed", {
        code: error instanceof SchemaCompatibilityError ? error.code : "server_start_failed",
        message:
          error instanceof SchemaCompatibilityError
            ? error.message
            : "OpenTeam could not start. If the database has not been upgraded, run `openteam upgrade`.",
      }),
    ),
    Effect.provide(Logger.layer([Logger.withConsoleError(Logger.formatJson)])),
  );
}
