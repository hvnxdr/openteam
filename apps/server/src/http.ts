import { HealthResponse, ServiceUnavailable } from "@openteam/contracts";
import { Effect, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { HttpRouter, HttpServer } from "effect/http";
import { SqlClient } from "effect/sql";
import type { ServerConfig } from "./config.ts";
import { sqliteLayer } from "./db/sqlite.ts";
import { SCHEMA_ARTIFACT_HASH, SCHEMA_VERSION } from "./operations/upgrade.ts";

export const SERVER_VERSION = "0.0.0";

export class SchemaCompatibilityError extends Schema.TaggedError<SchemaCompatibilityError>()(
  "SchemaCompatibilityError",
  {
    code: Schema.Literal("schema_upgrade_required"),
    message: Schema.String,
  },
) {}

const HealthGroup = HttpApiGroup.make("foundation").add(
  HttpApiEndpoint.get("health", "/v1/health", {
    success: HealthResponse.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(200)),
    error: ServiceUnavailable.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(503)),
  }),
);

const Api = HttpApi.make("openteam").add(HealthGroup);

export function assertSchemaCompatible(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const tables = yield* sql<{ name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_version'
    `;
    const rows =
      tables.length === 0
        ? []
        : yield* sql<{ version: string; artifact_hash: string }>`
        SELECT version, artifact_hash FROM schema_version
      `;
    const current = rows.find((row) => row.version === SCHEMA_VERSION);
    if (current === undefined || current.artifact_hash !== SCHEMA_ARTIFACT_HASH) {
      return yield* new SchemaCompatibilityError({
        code: "schema_upgrade_required",
        message:
          "The database schema is missing or incompatible. Run `openteam upgrade` before starting the server.",
      });
    }
  });
}

const Handlers = HttpApiBuilder.group(Api, "foundation", (handlers) =>
  handlers.handleAll({
    health: () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`SELECT version FROM schema_version LIMIT 1`;
        return { status: "ok", version: SERVER_VERSION } as const;
      }).pipe(
        Effect.catch(
          () =>
            new ServiceUnavailable({
              code: "database_unavailable",
              message: "The database is unavailable.",
            }),
        ),
      ),
  }),
);

const Routes = HttpApiBuilder.layer(Api).pipe(Layer.provide(Handlers));

export function makeHttpServerLayer<A, E>(
  config: ServerConfig,
  platform: Layer.Layer<HttpServer.HttpServer | A, E>,
) {
  const database = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* assertSchemaCompatible(sql);
    }),
  ).pipe(Layer.provideMerge(sqliteLayer(config.databasePath, false)));

  return HttpRouter.serve(Routes).pipe(Layer.provide(database), Layer.provideMerge(platform));
}
