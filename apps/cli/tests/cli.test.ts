import { expect, test } from "bun:test";

test("CLI workspace test entry point runs under Bun", () => {
  expect(process.platform).toBeDefined();
});
