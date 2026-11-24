import { expect, test } from "bun:test";
import {
  BadRequest,
  CreateProbeResponse,
  IdempotencyConflict,
  ListProbesResponse,
  ServiceUnavailable,
  TransportError,
} from "@openteam/contracts";
import { Schema } from "effect";
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

test("createProbe sends a shared-schema request and decodes the created probe", async () => {
  const requests: Array<{ input: string | URL | Request; init: RequestInit | undefined }> = [];
  const responseBody = {
    probe: {
      id: "prb_01JABC",
      message: "Foundation probe",
      createdAt: "2026-11-24T09:00:00.000Z",
    },
    eventCursor: "evt_1",
  };
  const fetch: Fetch = (input, init) => {
    requests.push({ input, init });
    return Promise.resolve(Response.json(responseBody, { status: 201 }));
  };
  const client = createClient({ baseUrl: "http://127.0.0.1:3000/", fetch });

  const response = await client.createProbe({
    message: "Foundation probe",
    idempotencyKey: "create-1",
  });

  expect(Schema.decodeUnknownSync(CreateProbeResponse)(response)).toEqual(responseBody);
  expect(requests[0]?.input).toBe("http://127.0.0.1:3000/v1/foundation/probes");
  expect(requests[0]?.init?.method).toBe("POST");
  expect(new Headers(requests[0]?.init?.headers).get("Idempotency-Key")).toBe("create-1");
  expect(new Headers(requests[0]?.init?.headers).get("Content-Type")).toBe("application/json");
  const body = requests[0]?.init?.body;
  expect(typeof body).toBe("string");
  if (typeof body !== "string") {
    throw new Error("Expected a JSON request body");
  }
  expect(JSON.parse(body)).toEqual({ message: "Foundation probe" });
});

test("createProbe decodes typed validation, conflict, and unavailable errors", async () => {
  const cases = [
    {
      status: 400,
      body: { _tag: "BadRequest", code: "invalid_request", message: "Invalid request" },
      error: BadRequest,
    },
    {
      status: 409,
      body: {
        _tag: "IdempotencyConflict",
        code: "idempotency_key_conflict",
        message: "Key conflict",
      },
      error: IdempotencyConflict,
    },
    {
      status: 503,
      body: {
        _tag: "ServiceUnavailable",
        code: "database_unavailable",
        message: "Database unavailable",
      },
      error: ServiceUnavailable,
    },
  ] as const;

  for (const candidate of cases) {
    const fetch: Fetch = () =>
      Promise.resolve(Response.json(candidate.body, { status: candidate.status }));
    const client = createClient({ fetch });
    const error = await client
      .createProbe({ message: "Foundation probe", idempotencyKey: "create-1" })
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(error).toBeInstanceOf(candidate.error);
  }
});

test("listProbes encodes shared list options and decodes a cursor page", async () => {
  let requestUrl: string | URL | Request | undefined;
  const responseBody = {
    probes: [
      {
        id: "prb_01JABC",
        message: "Foundation probe",
        createdAt: "2026-11-24T09:00:00.000Z",
      },
    ],
    nextCursor: "prb_page_1",
  };
  const fetch: Fetch = (input) => {
    requestUrl = input;
    return Promise.resolve(Response.json(responseBody));
  };
  const client = createClient({ fetch });

  const response = await client.listProbes({ limit: 2, cursor: "prb_page_1/+=" });

  expect(Schema.decodeUnknownSync(ListProbesResponse)(response)).toEqual(responseBody);
  expect(requestUrl).toBe("/v1/foundation/probes?limit=2&cursor=prb_page_1%2F%2B%3D");
});

test("listProbes decodes typed bad-request and unavailable errors", async () => {
  const cases = [
    {
      status: 400,
      body: { _tag: "BadRequest", code: "invalid_cursor", message: "Invalid cursor" },
      error: BadRequest,
    },
    {
      status: 503,
      body: {
        _tag: "ServiceUnavailable",
        code: "database_unavailable",
        message: "Database unavailable",
      },
      error: ServiceUnavailable,
    },
  ] as const;

  for (const candidate of cases) {
    const fetch: Fetch = () =>
      Promise.resolve(Response.json(candidate.body, { status: candidate.status }));
    const client = createClient({ fetch });
    const error = await client.listProbes().then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(candidate.error);
  }
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
