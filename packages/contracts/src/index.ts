import { Schema } from "effect";

export const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  version: Schema.String,
});

export type HealthResponse = typeof HealthResponse.Type;

/** Temporary foundation probe command payload. */
export const CreateProbeRequest = Schema.Struct({
  message: Schema.String.check(Schema.isBetweenCodePoints(1, 200)),
});

export type CreateProbeRequest = typeof CreateProbeRequest.Type;

export const ProbeSummary = Schema.Struct({
  id: Schema.String,
  message: Schema.String,
  createdAt: Schema.String,
});

export type ProbeSummary = typeof ProbeSummary.Type;

export const CreateProbeResponse = Schema.Struct({
  probe: ProbeSummary,
  eventCursor: Schema.String,
});

export type CreateProbeResponse = typeof CreateProbeResponse.Type;

export const ListProbesRequest = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  cursor: Schema.optional(Schema.String),
});

export type ListProbesRequest = typeof ListProbesRequest.Type;

export const ListProbesResponse = Schema.Struct({
  probes: Schema.Array(ProbeSummary),
  nextCursor: Schema.optional(Schema.String),
});

export type ListProbesResponse = typeof ListProbesResponse.Type;

export const ProbeCreatedEvent = Schema.Struct({
  cursor: Schema.String,
  type: Schema.Literal("foundation.probe.created"),
  occurredAt: Schema.String,
  payload: Schema.Struct({
    probeId: Schema.String,
    message: Schema.String,
    createdAt: Schema.String,
  }),
});

export type ProbeCreatedEvent = typeof ProbeCreatedEvent.Type;

/** Durable Event union. Additional Event types extend this contract. */
export const FoundationEvent = ProbeCreatedEvent;
export type FoundationEvent = typeof FoundationEvent.Type;

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
export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
  code: Schema.Literals(["invalid_request", "invalid_cursor", "idempotency_key_required"]),
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
}) {}

export class IdempotencyConflict extends Schema.TaggedError<IdempotencyConflict>()(
  "IdempotencyConflict",
  {
    code: Schema.Literal("idempotency_key_conflict"),
    message: Schema.String,
    details: Schema.optional(Schema.Unknown),
  },
) {}

export const ProbeError = Schema.Union([BadRequest, IdempotencyConflict, ServiceUnavailable]);
export type ProbeError = typeof ProbeError.Type;

export class OpenTeamError extends Schema.TaggedError<OpenTeamError>()("OpenTeamError", {
  code: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
}) {}

export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}
