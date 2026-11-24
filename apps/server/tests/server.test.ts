import { expect, test } from "bun:test";

test("server workspace test entry point runs under Bun", () => {
  expect(typeof Bun.version).toBe("string");
});
