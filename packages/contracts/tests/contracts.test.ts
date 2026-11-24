import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { HealthResponse, OpenTeamError, ServiceUnavailable, TransportError } from "../src/index.ts";

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

describe("shared errors", () => {
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
