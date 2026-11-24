import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaces = ["apps/server", "apps/web", "apps/cli", "packages/contracts", "packages/client"];

function manifest(workspace: string) {
  return JSON.parse(readFileSync(join(repositoryRoot, workspace, "package.json"), "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts: Record<string, string>;
  };
}

function dependencies(workspace: string) {
  const packageJson = manifest(workspace);
  return { ...packageJson.dependencies, ...packageJson.devDependencies };
}

test("contracts are schema-only", () => {
  const contracts = dependencies("packages/contracts");
  expect(Object.keys(contracts).filter((name) => name.startsWith("@openteam/"))).toEqual([]);
  expect(contracts).not.toHaveProperty("drizzle-orm");
  expect(contracts).not.toHaveProperty("@effect/sql-sqlite-bun");
  expect(contracts).not.toHaveProperty("@effect/platform-bun");
  expect(contracts).not.toHaveProperty("react");
  expect(contracts).not.toHaveProperty("effect-http");
});

test("client workspaces do not depend on server or database internals", () => {
  for (const workspace of ["apps/web", "packages/client"]) {
    const packageDependencies = dependencies(workspace);
    expect(packageDependencies).not.toHaveProperty("@openteam/server");
    expect(packageDependencies).not.toHaveProperty("drizzle-orm");
    expect(packageDependencies).not.toHaveProperty("@effect/sql-sqlite-bun");
  }
  expect(dependencies("packages/client")["@openteam/contracts"]).toBe("workspace:*");
});

test("the web app uses the client and never embeds Effect", () => {
  const web = dependencies("apps/web");
  expect(web["@openteam/client"]).toBe("workspace:*");
  expect(web).not.toHaveProperty("effect");
  expect(web).not.toHaveProperty("@effect/platform-bun");
  expect(web).not.toHaveProperty("@effect/sql-sqlite-bun");
});

test("every workspace exposes build and test entry points", () => {
  for (const workspace of workspaces) {
    const packageJson = manifest(workspace);
    expect(packageJson.name).toStartWith("@openteam/");
    expect(packageJson.scripts.build).toBeString();
    if (workspace === "apps/server") {
      expect(packageJson.scripts.upgrade).toBe("bun run src/upgrade.ts");
      expect(packageJson.scripts.generate).toBe("drizzle-kit generate");
    }
    if (workspace !== "apps/web") {
      expect(packageJson.scripts.test).toBe("bun test");
    }
  }
});
