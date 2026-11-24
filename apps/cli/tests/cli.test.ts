import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: Array<string> = [];
const cliEntryPoint = join(import.meta.dir, "../src/index.ts");

async function makeDataDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "openteam-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function runCli(args: Array<string>, env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, "run", cliEntryPoint, ...args], {
    env: { ...process.env, ...env },
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

describe("openteam upgrade", () => {
  test("upgrades the flag-selected data directory and can be reapplied", async () => {
    const dataDir = await makeDataDirectory();
    const environmentDirectory = await makeDataDirectory();

    const first = await runCli(["upgrade", "--data-dir", dataDir], {
      OPENTEAM_DATA_DIR: environmentDirectory,
    });
    const second = await runCli(["upgrade", "--data-dir", dataDir]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    const database = new Database(join(dataDir, "openteam.db"));
    const rows = database.query("SELECT version FROM schema_version").all();
    database.close();
    expect(rows).toEqual([{ version: "0000" }, { version: "0001" }]);
    expect(await Bun.file(join(environmentDirectory, "openteam.db")).exists()).toBe(false);
  });
});
