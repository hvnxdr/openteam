import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { BunHttpServer } from "@effect/platform-bun";
import { eventStream } from "@openteam/client/effect";
import {
  BadRequest,
  CreateProbeResponse,
  FoundationEvent,
  ServiceUnavailable,
} from "@openteam/contracts";
import { Effect, Deferred, Fiber, Schema, Stream } from "effect";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";
import * as Sse from "effect/encoding/Sse";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeHttpServerLayer } from "../src/http.ts";
import { runUpgrade } from "../src/operations/upgrade.ts";

const temporaryDirectories: Array<string> = [];

async function makeUpgradedDataDirectory() {
  const dataDir = await mkdtemp(join(tmpdir(), "openteam-events-"));
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

const OpenTeamSseEvent = Schema.Struct({
  id: Schema.String,
  event: Schema.Literal("openteam"),
  data: Schema.fromJsonString(FoundationEvent),
});

function createProbe(client: HttpClient.HttpClient, key: string, message: string) {
  return client.post("/v1/foundation/probes", {
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: HttpBody.jsonUnsafe({ message }),
  });
}

function decodeEventStream(response: HttpClientResponse.HttpClientResponse) {
  return HttpClientResponse.stream(Effect.succeed(response)).pipe(
    Stream.decodeText,
    Stream.pipeThroughChannel(Sse.decodeSchema(OpenTeamSseEvent)),
    Stream.map((frame) => frame.data),
  );
}

function decodeEvents(response: HttpClientResponse.HttpClientResponse, take: number) {
  return decodeEventStream(response).pipe(Stream.take(take), Stream.runCollect);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("durable Event SSE endpoint", () => {
  test("streams a newly committed Event with named cursor frames and disabled caching", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const response = yield* client.get("/v1/events", {
          headers: { Accept: "text/event-stream" },
        });

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("text/event-stream");
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.headers["x-accel-buffering"]).toBe("no");

        const received = yield* decodeEvents(response, 1).pipe(Effect.forkChild);
        const created = yield* createProbe(client, "live-1", "Live probe");
        const body: unknown = yield* created.json;
        const result = Schema.decodeUnknownSync(CreateProbeResponse)(body);
        const [event] = yield* Fiber.join(received).pipe(Effect.timeout("3 seconds"));

        expect(event).toEqual({
          cursor: result.eventCursor,
          type: "foundation.probe.created",
          occurredAt: result.probe.createdAt,
          payload: {
            probeId: result.probe.id,
            message: result.probe.message,
            createdAt: result.probe.createdAt,
          },
        });
      }),
    );
  });

  test("replays persisted Events and then follows new commits on the same connection", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        yield* createProbe(client, "replay-follow-1", "Persisted Event");
        const response = yield* client.get("/v1/events", {
          headers: { Accept: "text/event-stream" },
        });
        const received = yield* decodeEvents(response, 2).pipe(Effect.forkChild);
        yield* createProbe(client, "replay-follow-2", "Live Event");
        const events = yield* Fiber.join(received).pipe(Effect.timeout("3 seconds"));

        expect(events.map((event) => event.cursor)).toEqual(["evt_1", "evt_2"]);
        expect(events.map((event) => event.payload.message)).toEqual([
          "Persisted Event",
          "Live Event",
        ]);
      }),
    );
  });

  test("sends idle comment heartbeats without creating Events", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const response = yield* client.get("/v1/events", {
          headers: { Accept: "text/event-stream" },
        });
        const chunks = yield* HttpClientResponse.stream(Effect.succeed(response)).pipe(
          Stream.decodeText,
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("3 seconds"),
        );

        expect(chunks).toEqual([": keepalive\n\n"]);
      }),
    );
  });

  test("the Effect client stream resumes after a cursor and decodes shared Events", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        yield* createProbe(client, "effect-1", "First Event");
        const created = yield* createProbe(client, "effect-2", "Second Event");
        const body: unknown = yield* created.json;
        const result = Schema.decodeUnknownSync(CreateProbeResponse)(body);

        const received = yield* eventStream(client, { cursor: "evt_1" }).pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("3 seconds"),
        );

        expect(received).toEqual([
          {
            cursor: result.eventCursor,
            type: "foundation.probe.created",
            occurredAt: result.probe.createdAt,
            payload: {
              probeId: result.probe.id,
              message: result.probe.message,
              createdAt: result.probe.createdAt,
            },
          },
        ]);
      }),
    );
  });

  test("replays every missed Event in order after disconnect and tolerates a repeated cursor", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        yield* createProbe(client, "offline-1", "Before disconnect");
        const initial = yield* eventStream(client).pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("3 seconds"),
        );
        expect(initial.map((event) => event.cursor)).toEqual(["evt_1"]);

        yield* createProbe(client, "offline-2", "Missed second");
        yield* createProbe(client, "offline-3", "Missed third");

        const replay = () =>
          eventStream(client, { cursor: "evt_1" }).pipe(
            Stream.take(2),
            Stream.runCollect,
            Effect.timeout("3 seconds"),
          );
        const firstReconnect = yield* replay();
        const repeatedCursor = yield* replay();

        expect(firstReconnect.map((event) => event.cursor)).toEqual(["evt_2", "evt_3"]);
        expect(repeatedCursor.map((event) => event.cursor)).toEqual(["evt_2", "evt_3"]);
        expect(firstReconnect.map((event) => event.payload.message)).toEqual([
          "Missed second",
          "Missed third",
        ]);
      }),
    );
  });

  test("waits on a cursor ahead of the current head and follows the next commit", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        yield* createProbe(client, "ahead-existing", "Current head");
        const response = yield* client.get("/v1/events", {
          headers: { Accept: "text/event-stream", "Last-Event-ID": "evt_2" },
        });
        const received = yield* decodeEvents(response, 1).pipe(Effect.forkChild);
        yield* createProbe(client, "ahead-1", "Reaches the resume cursor");
        const created = yield* createProbe(client, "ahead-2", "Future Event");
        const body: unknown = yield* created.json;
        const result = Schema.decodeUnknownSync(CreateProbeResponse)(body);
        expect(result.eventCursor).toBe("evt_3");
        const [event] = yield* Fiber.join(received).pipe(Effect.timeout("3 seconds"));

        expect(event?.cursor).toBe(result.eventCursor);
        expect(event?.payload.message).toBe("Future Event");
      }),
    );
  });

  test("replays persisted Events after restarting against the same database", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        yield* createProbe(client, "restart-1", "Before restart");
        const created = yield* createProbe(client, "restart-2", "Persisted Event");
        const body: unknown = yield* created.json;
        expect(Schema.decodeUnknownSync(CreateProbeResponse)(body).eventCursor).toBe("evt_2");
      }),
    );
    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const replayed = yield* eventStream(client, { cursor: "evt_1" }).pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("3 seconds"),
        );

        expect(replayed.map((event) => event.cursor)).toEqual(["evt_2"]);
        expect(replayed[0]?.payload.message).toBe("Persisted Event");
      }),
    );
  });

  test("does not replay rejected mutations or break Event sequence continuity", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        yield* createProbe(client, "sequence-1", "Committed before rejection");
        const database = new Database(join(dataDir, "openteam.db"));
        database.run(`
          CREATE TRIGGER fail_command_receipt
          BEFORE INSERT ON command_receipts
          BEGIN
            SELECT RAISE(ABORT, 'forced receipt failure');
          END
        `);
        database.close();
        const response = yield* client.get("/v1/events", {
          headers: { Accept: "text/event-stream", "Last-Event-ID": "evt_1" },
        });
        const received = yield* decodeEvents(response, 1).pipe(Effect.forkChild);

        const failed = yield* createProbe(client, "sequence-2", "Must roll back");
        const failedBody: unknown = yield* failed.json;
        expect(failed.status).toBe(503);
        expect(Schema.decodeUnknownSync(ServiceUnavailable)(failedBody).code).toBe(
          "database_unavailable",
        );

        const reopened = new Database(join(dataDir, "openteam.db"));
        reopened.run("DROP TRIGGER fail_command_receipt");
        reopened.close();

        const retry = yield* createProbe(client, "sequence-2", "Committed after rejection");
        const retryBody: unknown = yield* retry.json;
        const result = Schema.decodeUnknownSync(CreateProbeResponse)(retryBody);
        expect(result.eventCursor).toBe("evt_2");
        const [event] = yield* Fiber.join(received).pipe(Effect.timeout("3 seconds"));

        expect(event?.cursor).toBe("evt_2");
        expect(event?.payload.message).toBe("Committed after rejection");
        const verified = new Database(join(dataDir, "openteam.db"));
        expect(verified.query("SELECT cursor FROM events ORDER BY seq").all()).toEqual([
          { cursor: "evt_1" },
          { cursor: "evt_2" },
        ]);
        verified.close();
      }),
    );
  });

  test("a slow subscriber does not block commits or another subscriber", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        yield* createProbe(client, "slow-1", "First Event");
        const slowResponse = yield* client.get("/v1/events", {
          headers: { Accept: "text/event-stream" },
        });
        const firstReceived = yield* Deferred.make<void>();
        const slow = yield* decodeEventStream(slowResponse).pipe(
          Stream.tap(() =>
            Deferred.succeed(firstReceived, undefined).pipe(
              Effect.andThen(Effect.sleep("500 millis")),
            ),
          ),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(firstReceived).pipe(Effect.timeout("3 seconds"));

        const created = yield* createProbe(client, "slow-2", "Second Event");
        const body: unknown = yield* created.json;
        const result = Schema.decodeUnknownSync(CreateProbeResponse)(body);
        const fastResponse = yield* client.get("/v1/events", {
          headers: { Accept: "text/event-stream", "Last-Event-ID": "evt_1" },
        });
        const fast = yield* decodeEvents(fastResponse, 1).pipe(Effect.timeout("3 seconds"));

        expect(fast.map((event) => event.cursor)).toEqual([result.eventCursor]);
        yield* Fiber.interrupt(slow);
      }),
    );
  });

  test("the Effect client stream surfaces invalid cursors as typed failures", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const error = yield* eventStream(client, { cursor: "invalid" }).pipe(
          Stream.runCollect,
          Effect.flip,
        );

        expect(error).toBeInstanceOf(BadRequest);
        if (!(error instanceof BadRequest)) {
          throw new Error("Expected a typed cursor error");
        }
        expect(error.code).toBe("invalid_cursor");
      }),
    );
  });

  test("rejects an invalid Last-Event-ID cursor with a typed response", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const response = yield* client.get("/v1/events", {
          headers: { "Last-Event-ID": "not-a-cursor" },
        });
        const body: unknown = yield* response.json;

        expect(response.status).toBe(400);
        expect(Schema.decodeUnknownSync(BadRequest)(body).code).toBe("invalid_cursor");
      }),
    );
  });
});
