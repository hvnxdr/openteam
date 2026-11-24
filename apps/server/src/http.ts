import {
  BadRequest,
  CreateProbeRequest,
  CreateProbeResponse,
  HealthResponse,
  IdempotencyConflict,
  ListProbesResponse,
  ServiceUnavailable,
} from "@openteam/contracts";
import { Effect, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { SqlClient } from "effect/sql";
import type { ServerConfig } from "./config.ts";
import { sqliteLayer } from "./db/sqlite.ts";
import { SCHEMA_ARTIFACT_HASH, SCHEMA_VERSION } from "./operations/upgrade.ts";
import { DEFAULT_PROBE_PAGE_LIMIT, MAX_PROBE_PAGE_LIMIT, ProbeStore } from "./probes.ts";

export const SERVER_VERSION = "0.0.0";

export class SchemaCompatibilityError extends Schema.TaggedError<SchemaCompatibilityError>()(
  "SchemaCompatibilityError",
  {
    code: Schema.Literal("schema_upgrade_required"),
    message: Schema.String,
  },
) {}

const IdempotencyKey = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200));
const ProbePageLimit = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: MAX_PROBE_PAGE_LIMIT }),
);

class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "openteam/SchemaErrorMiddleware",
  { error: BadRequest },
) {}

const HealthGroup = HttpApiGroup.make("foundation").add(
  HttpApiEndpoint.get("health", "/v1/health", {
    success: HealthResponse.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(200)),
    error: ServiceUnavailable.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(503)),
  }),
  HttpApiEndpoint.post("createProbe", "/v1/foundation/probes", {
    headers: { "idempotency-key": IdempotencyKey },
    payload: CreateProbeRequest,
    success: [
      CreateProbeResponse.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(201)),
      CreateProbeResponse.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(200)),
    ],
    error: [
      BadRequest.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(400)),
      IdempotencyConflict.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(409)),
      ServiceUnavailable.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(503)),
    ],
  }),
  HttpApiEndpoint.get("listProbes", "/v1/foundation/probes", {
    query: {
      limit: Schema.optional(ProbePageLimit),
      cursor: Schema.optional(Schema.String),
    },
    success: ListProbesResponse.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(200)),
    error: [
      BadRequest.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(400)),
      ServiceUnavailable.pipe(HttpApiSchema.asJson(), HttpApiSchema.status(503)),
    ],
  }),
);

const Api = HttpApi.make("openteam").add(HealthGroup).middleware(SchemaErrorMiddleware);

const SchemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(
  SchemaErrorMiddleware,
  (error) =>
    Effect.fail(
      new BadRequest({
        code: error.kind === "Headers" ? "idempotency_key_required" : "invalid_request",
        message: "The request is invalid.",
        details: { component: error.kind },
      }),
    ),
);

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

const Handlers = HttpApiBuilder.group(
  Api,
  "foundation",
  Effect.fn(function* (handlers) {
    const store = yield* ProbeStore;
    return handlers.handleAll({
      health: () =>
        Effect.gen(function* () {
          yield* store.health();
          return { status: "ok", version: SERVER_VERSION } as const;
        }),
      createProbe: ({ headers, payload }) =>
        Effect.gen(function* () {
          const result = yield* store.create({
            ...payload,
            idempotencyKey: headers["idempotency-key"],
          });
          return yield* HttpServerResponse.schemaJson(CreateProbeResponse)(result.response, {
            status: result.retried ? 200 : 201,
          }).pipe(Effect.orDie);
        }),
      listProbes: ({ query }) =>
        store.list({
          limit: query.limit ?? DEFAULT_PROBE_PAGE_LIMIT,
          cursor: query.cursor,
        }),
    });
  }),
);

export function makeHttpServerLayer<A, E>(
  config: ServerConfig,
  platform: Layer.Layer<HttpServer.HttpServer | A, E>,
) {
  const services = Layer.merge(
    ProbeStore.layer,
    Layer.effectDiscard(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* assertSchemaCompatible(sql);
      }),
    ),
  ).pipe(Layer.provide(sqliteLayer(config.databasePath, false)));
  const Routes = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(Handlers.pipe(Layer.provide(services))),
    Layer.provide(SchemaErrorLayer),
  );

  return HttpRouter.serve(Routes).pipe(Layer.provideMerge(platform));
}
