import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUpgrade } from "../src/operations/upgrade.ts";

const temporaryDirectories: Array<string> = [];
const serverEntryPoint = join(import.meta.dir, "../src/index.ts");

async function makeDataDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "openteam-server-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function runServer(dataDir: string) {
  const child = Bun.spawn([process.execPath, "run", serverEntryPoint], {
    env: {
      ...globalThis.process.env,
      OPENTEAM_DATA_DIR: dataDir,
      OPENTEAM_HOST: "127.0.0.1",
      OPENTEAM_PORT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timeout);
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("server startup", () => {
  test("refuses to start a missing schema with an actionable upgrade message", async () => {
    const dataDir = await makeDataDirectory();

    const result = await runServer(dataDir);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('"level":"ERROR"');
    expect(result.stderr).toContain("server_start_failed");
    expect(result.stderr).toContain("openteam upgrade");
    for (const line of result.stderr.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("refuses to start an outdated schema without changing it", async () => {
    const dataDir = await makeDataDirectory();
    await Effect.runPromise(runUpgrade({ dataDir }));
    const database = new Database(join(dataDir, "openteam.db"));
    database.run("DELETE FROM schema_version WHERE version = '0001'");
    database.run("UPDATE schema_version SET version = 'outdated', artifact_hash = 'outdated'");
    database.close();

    const result = await runServer(dataDir);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("openteam upgrade");
    const reopened = new Database(join(dataDir, "openteam.db"));
    const rows = reopened.query("SELECT version, artifact_hash FROM schema_version").all();
    reopened.close();
    expect(rows).toEqual([{ version: "outdated", artifact_hash: "outdated" }]);
  });
});
