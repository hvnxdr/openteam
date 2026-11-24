import { expect, test } from "bun:test";
import { ServiceUnavailable, TransportError } from "@openteam/contracts";
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

test("health uses a same-origin URL by default", async () => {
  let requestUrl: string | URL | Request | undefined;
  const fetch: Fetch = (input) => {
    requestUrl = input;
    return Promise.resolve(Response.json({ status: "ok", version: "0.0.0" }));
  };
  const client = createClient({ fetch });

  await client.health();

  expect(requestUrl).toBe("/v1/health");
});

test("health decodes a successful response through the injected fetch", async () => {
  const requests: Array<{ input: string | URL | Request; init: RequestInit | undefined }> = [];
  const fetch: Fetch = (input, init) => {
    requests.push({ input, init });
    return Promise.resolve(Response.json({ status: "ok", version: "0.0.0" }, { status: 200 }));
  };
  const client = createClient({ baseUrl: "http://127.0.0.1:3000/", fetch });

  expect(await client.health()).toEqual({ status: "ok", version: "0.0.0" });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.input).toBe("http://127.0.0.1:3000/v1/health");
});

test("health decodes a typed service-unavailable response", async () => {
  const fetch: Fetch = () =>
    Promise.resolve(
      Response.json(
        {
          _tag: "ServiceUnavailable",
          code: "database_unavailable",
          message: "The database is unavailable",
        },
        { status: 503 },
      ),
    );
  const client = createClient({ fetch });

  const error = await client.health().then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(ServiceUnavailable);
});

test("health reports network failures as transport errors", async () => {
  const fetch: Fetch = () => Promise.reject(new Error("connection refused"));
  const client = createClient({ fetch });

  const error = await client.health().then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(TransportError);
});

test("health reports undeclared HTTP statuses as transport errors", async () => {
  const fetch: Fetch = () =>
    Promise.resolve(Response.json({ message: "unexpected" }, { status: 500 }));
  const client = createClient({ fetch });

  const error = await client.health().then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(TransportError);
});

test("health reports malformed responses as transport errors", async () => {
  const fetch: Fetch = () => Promise.resolve(new Response("not json", { status: 200 }));
  const client = createClient({ fetch });

  const error = await client.health().then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(TransportError);
});
