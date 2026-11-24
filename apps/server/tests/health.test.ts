import { afterEach, describe, expect, test } from "bun:test";
import { BunHttpServer } from "@effect/platform-bun";
import { Database } from "bun:sqlite";
import { HealthResponse, ServiceUnavailable } from "@openteam/contracts";
import { Effect, Schema } from "effect";
import { HttpClient } from "effect/http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeHttpServerLayer } from "../src/http.ts";
import { runUpgrade } from "../src/operations/upgrade.ts";

const temporaryDirectories: Array<string> = [];

async function makeUpgradedDataDirectory() {
  const dataDir = await mkdtemp(join(tmpdir(), "openteam-health-"));
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("health endpoint", () => {
  test("reports readiness after an explicit upgrade", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const response = yield* client.get("/v1/health");
        const body: unknown = yield* response.json;

        expect(response.status).toBe(200);
        expect(Schema.decodeUnknownSync(HealthResponse)(body)).toEqual({
          status: "ok",
          version: "0.0.0",
        });
      }),
    );
  });

  test("returns a typed service-unavailable response when the database query fails", async () => {
    const dataDir = await makeUpgradedDataDirectory();

    await withServer(dataDir, (client) =>
      Effect.gen(function* () {
        const database = new Database(join(dataDir, "openteam.db"));
        database.run("DROP TABLE schema_version");
        database.close();

        const response = yield* client.get("/v1/health");
        const body: unknown = yield* response.json;

        expect(response.status).toBe(503);
        expect(Schema.decodeUnknownSync(ServiceUnavailable)(body)).toMatchObject({
          _tag: "ServiceUnavailable",
          code: "database_unavailable",
        });
      }),
    );
  });
});
