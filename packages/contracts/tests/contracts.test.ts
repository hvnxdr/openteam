import { describe, expect, test } from "bun:test";
import { OpenTeamError, TransportError } from "../src/index.ts";

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
