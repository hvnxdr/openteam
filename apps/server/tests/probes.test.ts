import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { BunHttpServer } from "@effect/platform-bun";
import {
  BadRequest,
  CreateProbeResponse,
  IdempotencyConflict,
  ListProbesResponse,
  ServiceUnavailable,
} from "@openteam/contracts";
import { Effect, Schema } from "effect";
import { HttpBody, HttpClient } from "effect/http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeHttpServerLayer } from "../src/http.ts";
import { runUpgrade } from "../src/operations/upgrade.ts";

const temporaryDirectories: Array<string> = [];

async function makeUpgradedDataDirectory() {
  const dataDir = await mkdtemp(join(tmpdir(), "openteam-probes-"));
  temporaryDirectories.push(dataDir);
  await Effect.runPromise(runUpgrade({ dataDir }));
  return dataDir;
}

function withServer(
  dataDir: string,
  use: (client: HttpClient.HttpClient) => Effect.Effect<void, unknown>,
) {
  const server = makeHttpServerLayer(
    {
      host: "127.0.0.1",
      port: 0,
      dataDir,
      databasePath: join(dataDir, "openteam.db"),
    },
    BunHttpServer.layerTest,
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      yield* use(client);
    }).pipe(Effect.provide(server), Effect.scoped),
  );
}

function createProbe(client: HttpClient.HttpClient, key: string, message: string) {
  return client.post("/v1/foundation/probes", {
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: HttpBody.jsonUnsafe({ message }),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("foundation probe endpoints", () => {
  test("returns the original response for an identical retry without duplicate effects", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const first = yield* createProbe(client, "retry-1", "Retryable probe");
        const firstBody: unknown = yield* first.json;
        const retry = yield* createProbe(client, "retry-1", "Retryable probe");
        const retryBody: unknown = yield* retry.json;

        expect(first.status).toBe(201);
        expect(retry.status).toBe(200);
        expect(retryBody).toEqual(firstBody);

        const listed = yield* client.get("/v1/foundation/probes");
        const listing = Schema.decodeUnknownSync(ListProbesResponse)(yield* listed.json);
        expect(listing.probes).toHaveLength(1);

        const database = new Database(join(dataDir, "openteam.db"));
        const events = database.query("SELECT COUNT(*) AS count FROM events").get();
        const receipts = database.query("SELECT COUNT(*) AS count FROM command_receipts").get();
        database.close();
        expect(events).toEqual({ count: 1 });
        expect(receipts).toEqual({ count: 1 });
      }),
    );
  });

  test("rejects a reused idempotency key for another command without changing state", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        yield* createProbe(client, "conflict-1", "Original probe");
        const conflict = yield* createProbe(client, "conflict-1", "Different probe");
        const body: unknown = yield* conflict.json;

        expect(conflict.status).toBe(409);
        expect(Schema.decodeUnknownSync(IdempotencyConflict)(body).code).toBe(
          "idempotency_key_conflict",
        );

        const listed = yield* client.get("/v1/foundation/probes");
        const listing = Schema.decodeUnknownSync(ListProbesResponse)(yield* listed.json);
        expect(listing.probes.map((probe) => probe.message)).toEqual(["Original probe"]);

        const database = new Database(join(dataDir, "openteam.db"));
        expect(database.query("SELECT COUNT(*) AS count FROM events").get()).toEqual({ count: 1 });
        expect(database.query("SELECT COUNT(*) AS count FROM command_receipts").get()).toEqual({
          count: 1,
        });
        database.close();
      }),
    );
  });

  test("rejects invalid requests with typed errors before persisting or sequencing", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        for (const message of ["", "x".repeat(201)]) {
          const invalid = yield* createProbe(client, "invalid-message", message);
          const body: unknown = yield* invalid.json;
          expect(invalid.status).toBe(400);
          expect(Schema.decodeUnknownSync(BadRequest)(body).code).toBe("invalid_request");
        }

        const missingKey = yield* client.post("/v1/foundation/probes", {
          headers: { "Content-Type": "application/json" },
          body: HttpBody.jsonUnsafe({ message: "Missing key" }),
        });
        const missingKeyBody: unknown = yield* missingKey.json;
        expect(missingKey.status).toBe(400);
        expect(Schema.decodeUnknownSync(BadRequest)(missingKeyBody).code).toBe(
          "idempotency_key_required",
        );

        const listed = yield* client.get("/v1/foundation/probes");
        expect(Schema.decodeUnknownSync(ListProbesResponse)(yield* listed.json)).toEqual({
          probes: [],
        });
        const database = new Database(join(dataDir, "openteam.db"));
        expect(database.query("SELECT COUNT(*) AS count FROM events").get()).toEqual({ count: 0 });
        expect(database.query("SELECT COUNT(*) AS count FROM command_receipts").get()).toEqual({
          count: 0,
        });
        database.close();

        const valid = yield* createProbe(client, "after-invalid", "Valid probe");
        const response = Schema.decodeUnknownSync(CreateProbeResponse)(yield* valid.json);
        expect(response.eventCursor).toBe("evt_1");
      }),
    );
  });

  test("rolls back every effect when a late persistence step fails", async () => {
    const dataDir = await makeUpgradedDataDirectory();
    const database = new Database(join(dataDir, "openteam.db"));
    database.run(`
      CREATE TRIGGER fail_command_receipt
      BEFORE INSERT ON command_receipts
      BEGIN
        SELECT RAISE(ABORT, 'forced receipt failure');
      END
    `);
    database.close();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const failed = yield* createProbe(client, "atomic-1", "Must roll back");
        const failedBody: unknown = yield* failed.json;
        expect(failed.status).toBe(503);
        expect(Schema.decodeUnknownSync(ServiceUnavailable)(failedBody).code).toBe(
          "database_unavailable",
        );

        const listed = yield* client.get("/v1/foundation/probes");
        expect(Schema.decodeUnknownSync(ListProbesResponse)(yield* listed.json)).toEqual({
          probes: [],
        });
        const reopened = new Database(join(dataDir, "openteam.db"));
        expect(reopened.query("SELECT COUNT(*) AS count FROM events").get()).toEqual({ count: 0 });
        expect(reopened.query("SELECT COUNT(*) AS count FROM foundation_probes").get()).toEqual({
          count: 0,
        });
        expect(reopened.query("SELECT COUNT(*) AS count FROM command_receipts").get()).toEqual({
          count: 0,
        });
        reopened.run("DROP TRIGGER fail_command_receipt");
        reopened.close();

        const retry = yield* createProbe(client, "atomic-1", "Commits after rollback");
        const response = Schema.decodeUnknownSync(CreateProbeResponse)(yield* retry.json);
        expect(retry.status).toBe(201);
        expect(response.eventCursor).toBe("evt_1");
      }),
    );
  });

  test("rejects out-of-range limits and malformed cursors with typed errors", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        for (const query of ["limit=0", "limit=101", "cursor=not-a-cursor"]) {
          const response = yield* client.get(`/v1/foundation/probes?${query}`);
          const body: unknown = yield* response.json;
          expect(response.status).toBe(400);
          expect(Schema.decodeUnknownSync(BadRequest)(body)._tag).toBe("BadRequest");
        }
      }),
    );
  });

  test("lists probes in bounded cursor pages without duplicates", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        for (const message of ["First probe", "Second probe", "Third probe"]) {
          yield* createProbe(client, message, message);
        }

        const firstPage = yield* client.get("/v1/foundation/probes?limit=2");
        const first = Schema.decodeUnknownSync(ListProbesResponse)(yield* firstPage.json);
        expect(first.probes.map((probe) => probe.message)).toEqual(["Third probe", "Second probe"]);
        expect(first.nextCursor).toMatch(/^prb_page_/);
        const cursor = first.nextCursor;
        if (cursor === undefined) {
          throw new Error("Expected a next cursor");
        }

        const secondPage = yield* client.get(
          `/v1/foundation/probes?limit=2&cursor=${encodeURIComponent(cursor)}`,
        );
        const second = Schema.decodeUnknownSync(ListProbesResponse)(yield* secondPage.json);
        expect(second).toEqual({
          probes: [expect.objectContaining({ message: "First probe" })],
        });
      }),
    );
  });

  test("creates a persisted probe and lists it with its committed Event cursor", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const created = yield* createProbe(client, "create-1", "Foundation probe");
        const createdBody: unknown = yield* created.json;
        const response = Schema.decodeUnknownSync(CreateProbeResponse)(createdBody);

        expect(created.status).toBe(201);
        expect(response.probe).toMatchObject({
          id: expect.stringMatching(/^prb_/),
          message: "Foundation probe",
          createdAt: expect.stringMatching(/Z$/),
        });
        expect(response.eventCursor).toBe("evt_1");

        const listed = yield* client.get("/v1/foundation/probes");
        const listedBody: unknown = yield* listed.json;
        const listing = Schema.decodeUnknownSync(ListProbesResponse)(listedBody);

        expect(listed.status).toBe(200);
        expect(listing).toEqual({ probes: [response.probe] });
      }),
    );
  });
});
