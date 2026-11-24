import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  BadRequest,
  CreateProbeRequest,
  CreateProbeResponse,
  FoundationEvent,
  HealthResponse,
  IdempotencyConflict,
  ListProbesRequest,
  ListProbesResponse,
  OpenTeamError,
  ServiceUnavailable,
  TransportError,
} from "../src/index.ts";

describe("health contract", () => {
  test("defines a successful readiness response with the server version", () => {
    const health = Schema.decodeUnknownSync(HealthResponse)({ status: "ok", version: "0.0.0" });

    expect(health).toEqual({ status: "ok", version: "0.0.0" });
  });

  test("defines a typed database-unavailable failure", () => {
    const error = Schema.decodeUnknownSync(ServiceUnavailable)({
      _tag: "ServiceUnavailable",
      code: "database_unavailable",
      message: "The database is unavailable",
    });

    expect(error).toBeInstanceOf(ServiceUnavailable);
    expect(error.code).toBe("database_unavailable");
  });
});

describe("probe creation contract", () => {
  test("accepts messages containing one through two hundred characters", () => {
    expect(Schema.decodeUnknownSync(CreateProbeRequest)({ message: "x" })).toEqual({
      message: "x",
    });
    expect(Schema.decodeUnknownSync(CreateProbeRequest)({ message: "x".repeat(200) })).toEqual({
      message: "x".repeat(200),
    });
  });

  test("rejects messages outside the supported length", () => {
    expect(() => Schema.decodeUnknownSync(CreateProbeRequest)({ message: "" })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CreateProbeRequest)({ message: "x".repeat(201) }),
    ).toThrow();
  });

  test("defines the persisted probe and committed Event cursor", () => {
    const response = Schema.decodeUnknownSync(CreateProbeResponse)({
      probe: {
        id: "prb_01JABC",
        message: "Foundation probe",
        createdAt: "2026-11-24T09:00:00.000Z",
      },
      eventCursor: "evt_1",
    });

    expect(response).toEqual({
      probe: {
        id: "prb_01JABC",
        message: "Foundation probe",
        createdAt: "2026-11-24T09:00:00.000Z",
      },
      eventCursor: "evt_1",
    });
  });
});

describe("probe listing contract", () => {
  test("defines a bounded optional page limit and opaque cursor", () => {
    expect(Schema.decodeUnknownSync(ListProbesRequest)({})).toEqual({});
    expect(
      Schema.decodeUnknownSync(ListProbesRequest)({ limit: 100, cursor: "prb_page_1" }),
    ).toEqual({
      limit: 100,
      cursor: "prb_page_1",
    });
    expect(() => Schema.decodeUnknownSync(ListProbesRequest)({ limit: 0 })).toThrow();
    expect(() => Schema.decodeUnknownSync(ListProbesRequest)({ limit: 101 })).toThrow();
  });

  test("defines probe summaries and an optional opaque next cursor", () => {
    const response = Schema.decodeUnknownSync(ListProbesResponse)({
      probes: [
        {
          id: "prb_01JABC",
          message: "Foundation probe",
          createdAt: "2026-11-24T09:00:00.000Z",
        },
      ],
      nextCursor: "prb_page_1",
    });

    expect(response.probes).toHaveLength(1);
    expect(response.nextCursor).toBe("prb_page_1");
    expect(Schema.decodeUnknownSync(ListProbesResponse)({ probes: [] })).toEqual({ probes: [] });
  });
});

describe("foundation Event contract", () => {
  test("defines the initial probe-created Event envelope", () => {
    const event = Schema.decodeUnknownSync(FoundationEvent)({
      cursor: "evt_1",
      type: "foundation.probe.created",
      occurredAt: "2026-11-24T09:00:00.000Z",
      payload: {
        probeId: "prb_01JABC",
        message: "Foundation probe",
        createdAt: "2026-11-24T09:00:00.000Z",
      },
    });

    expect(event.type).toBe("foundation.probe.created");
    expect(event.payload.probeId).toBe("prb_01JABC");
  });
});

describe("shared errors", () => {
  test("BadRequest retains a stable validation code and structured details", () => {
    const error = Schema.decodeUnknownSync(BadRequest)({
      _tag: "BadRequest",
      code: "invalid_request",
      message: "The request is invalid.",
      details: { field: "message" },
    });

    expect(error).toBeInstanceOf(BadRequest);
    expect(error.code).toBe("invalid_request");
    expect(error.details).toEqual({ field: "message" });
  });

  test("IdempotencyConflict identifies reuse of a key for another command", () => {
    const error = Schema.decodeUnknownSync(IdempotencyConflict)({
      _tag: "IdempotencyConflict",
      code: "idempotency_key_conflict",
      message: "The idempotency key was already used for another command.",
    });

    expect(error).toBeInstanceOf(IdempotencyConflict);
    expect(error.code).toBe("idempotency_key_conflict");
  });

  test("OpenTeamError retains its machine code and message", () => {
    const error = new OpenTeamError({ code: "not_found", message: "Issue not found" });
    expect(error.code).toBe("not_found");
    expect(error.message).toBe("Issue not found");
  });

  test("TransportError is distinct from an OpenTeam domain response", () => {
    const error = new TransportError({ message: "Network unavailable" });
    expect(error._tag).toBe("TransportError");
    expect(error.message).toBe("Network unavailable");
  });
});
