import { Schema } from "effect";

export const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  version: Schema.String,
});

export type HealthResponse = typeof HealthResponse.Type;

export class ServiceUnavailable extends Schema.TaggedError<ServiceUnavailable>()(
  "ServiceUnavailable",
  {
    code: Schema.Literal("database_unavailable"),
    message: Schema.String,
    details: Schema.optional(Schema.Unknown),
  },
) {}

/**
 * Shared OpenTeam wire contracts.
 *
 * This package intentionally contains schemas only. HTTP adapters, persistence,
 * and runtime composition belong to the server and client workspaces.
 */
export class OpenTeamError extends Schema.TaggedError<OpenTeamError>()("OpenTeamError", {
  code: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
}) {}

export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}
