import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const starterPaths = ["apps/website", "packages/utils"];
const workspacePaths = [
  "apps/server",
  "apps/web",
  "apps/cli",
  "packages/contracts",
  "packages/client",
];
const ignoredPaths = [
  "apps/server/dist/generated.js",
  "apps/web/dist/index.html",
  "apps/cli/dist/openteam",
  "packages/contracts/dist/index.mjs",
  "packages/client/dist/index.mjs",
  "data/local.db",
  "data/local.db-wal",
  "data/local.db-shm",
  "logs/server.log",
  ".env.local",
];

function manifest(path: string) {
  return JSON.parse(readFileSync(join(repositoryRoot, path), "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    catalog?: Record<string, string>;
    devEngines?: { packageManager: { name: string; version: string } };
  };
}

test("the repository contains only the five OpenTeam workspaces and no starter", () => {
  for (const path of starterPaths) {
    expect(existsSync(join(repositoryRoot, path))).toBe(false);
  }
  for (const path of workspacePaths) {
    expect(existsSync(join(repositoryRoot, path, "package.json"))).toBe(true);
    expect(existsSync(join(repositoryRoot, path, "tsconfig.json"))).toBe(true);
  }
  expect(readdirSync(join(repositoryRoot, "apps")).sort()).toEqual(["cli", "server", "web"]);
  expect(readdirSync(join(repositoryRoot, "packages")).sort()).toEqual(["client", "contracts"]);

  const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
  expect(readme).toStartWith("# OpenTeam");
  expect(readme).not.toContain("Vite+ Monorepo Starter");
  expect(readme).not.toContain("setupCounter");
});

test("root check, test, and build commands run through Bun and Vite+", () => {
  const packageJson = manifest("package.json");
  expect(packageJson.scripts?.check).toBe("vp check && vp run -r typecheck");
  expect(packageJson.scripts?.test).toBe("bun test");
  expect(packageJson.scripts?.build).toBe("vp run -r build");
  expect(packageJson.scripts?.ready).toBe("bun run check && bun run test && bun run build");
});

test("Bun and Vite+ versions are pinned through the workspace catalog", () => {
  const packageJson = manifest("package.json");
  expect(packageJson.devEngines?.packageManager).toMatchObject({ name: "bun", version: "1.4.5" });
  expect(packageJson.catalog?.["vite-plus"]).toBe("1.8.0");
  expect(existsSync(join(repositoryRoot, "bun.lock"))).toBe(true);
});

test("no manifest retains starter package metadata", () => {
  for (const path of [
    "package.json",
    ...workspacePaths.map((workspace) => `${workspace}/package.json`),
  ]) {
    const packageJson = manifest(path);
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("website");
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("utils");
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty("website");
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty("utils");
  }
});

test("generated output, local data, logs, and environment files are ignored", () => {
  for (const path of ignoredPaths) {
    const result = Bun.spawnSync(["git", "check-ignore", "--no-index", path], {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, `${path} is not ignored:\n${result.stderr.toString()}`).toBe(0);
  }
});
