import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { sqliteLayer } from "../src/db/sqlite.ts";
import { runUpgrade } from "../src/operations/upgrade.ts";

const temporaryDirectories: Array<string> = [];

async function makeDataDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "openteam-upgrade-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("explicit upgrade", () => {
  test("applies committed artifacts and records their ledger entries", async () => {
    const dataDir = await makeDataDirectory();

    const result = await Effect.runPromise(runUpgrade({ dataDir }));

    expect(result).toEqual({ applied: ["0000", "0001"], alreadyCurrent: false });
    const database = new Database(join(dataDir, "openteam.db"));
    const rows = database.query("SELECT version, artifact_hash FROM schema_version").all();
    database.close();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      { version: "0000", artifact_hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { version: "0001", artifact_hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
  });

  test("creates probe, Event, and command receipt tables with integrity constraints", async () => {
    const dataDir = await makeDataDirectory();
    await Effect.runPromise(runUpgrade({ dataDir }));
    const database = new Database(join(dataDir, "openteam.db"));

    const tables = database
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    const probeForeignKeys = database.query("PRAGMA foreign_key_list(foundation_probes)").all();
    const receiptForeignKeys = database.query("PRAGMA foreign_key_list(command_receipts)").all();
    const receiptIndexes = database.query("PRAGMA index_list(command_receipts)").all();
    database.close();

    expect(tables).toEqual(
      expect.arrayContaining(["foundation_probes", "events", "command_receipts", "schema_version"]),
    );
    expect(probeForeignKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: "events", from: "event_seq" })]),
    );
    expect(receiptForeignKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: "events", from: "event_seq" })]),
    );
    expect(receiptIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unique: 1,
          origin: "c",
          name: expect.stringContaining("event_seq"),
        }),
      ]),
    );
  });

  test("upgrades a database already at the initial schema version", async () => {
    const dataDir = await makeDataDirectory();
    await Effect.runPromise(runUpgrade({ dataDir }));
    const database = new Database(join(dataDir, "openteam.db"));
    database.run("DELETE FROM schema_version WHERE version = '0001'");
    database.run("DROP TABLE command_receipts");
    database.run("DROP TABLE foundation_probes");
    database.run("DROP TABLE events");
    database.close();

    const result = await Effect.runPromise(runUpgrade({ dataDir }));

    expect(result).toEqual({ applied: ["0001"], alreadyCurrent: false });
    const reopened = new Database(join(dataDir, "openteam.db"));
    expect(reopened.query("SELECT version FROM schema_version ORDER BY version").all()).toEqual([
      { version: "0000" },
      { version: "0001" },
    ]);
    reopened.close();
  });

  test("reapplying the current upgrade is a successful no-op", async () => {
    const dataDir = await makeDataDirectory();
    await Effect.runPromise(runUpgrade({ dataDir }));
    const database = new Database(join(dataDir, "openteam.db"));
    const before = database
      .query("SELECT version, artifact_hash, applied_at FROM schema_version")
      .all();
    database.close();

    const result = await Effect.runPromise(runUpgrade({ dataDir }));

    expect(result).toEqual({ applied: [], alreadyCurrent: true });
    const reopened = new Database(join(dataDir, "openteam.db"));
    const after = reopened
      .query("SELECT version, artifact_hash, applied_at FROM schema_version")
      .all();
    reopened.close();
    expect(after).toEqual(before);
  });

  test("opens upgraded databases in WAL mode with foreign keys and a bounded busy timeout", async () => {
    const dataDir = await makeDataDirectory();
    await Effect.runPromise(runUpgrade({ dataDir }));

    const settings = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const journal = yield* sql<{ journal_mode: string }>`PRAGMA journal_mode`;
        const foreignKeys = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys`;
        const busyTimeout = yield* sql<{ timeout: number }>`PRAGMA busy_timeout`;
        return { journal: journal[0], foreignKeys: foreignKeys[0], busyTimeout: busyTimeout[0] };
      }).pipe(Effect.provide(sqliteLayer(join(dataDir, "openteam.db"), false))),
    );

    expect(settings).toEqual({
      journal: { journal_mode: "wal" },
      foreignKeys: { foreign_keys: 1 },
      busyTimeout: { timeout: 5000 },
    });
  });
});
