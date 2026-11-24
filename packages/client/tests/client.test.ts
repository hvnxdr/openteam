import { expect, test } from "bun:test";
import { createClient, type Fetch } from "../src/index.ts";

test("the client defaults to same-origin requests", () => {
  const client = createClient();
  expect(client.baseUrl).toBe("");
  expect(client.fetch).toBe(globalThis.fetch);
});

test("the client accepts an injectable fetch implementation and server URL", () => {
  const fetch: Fetch = () => {
    throw new Error("not used");
  };
  const client = createClient({ baseUrl: "http://127.0.0.1:3000", fetch });
  expect(client.baseUrl).toBe("http://127.0.0.1:3000");
  expect(client.fetch).toBe(fetch);
});
