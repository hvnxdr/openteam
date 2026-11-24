import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function readJson(path: string) {
  return JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
}

test("the shared TypeScript baseline is strict", () => {
  const base = readJson("tsconfig.base.json");
  expect(base.compilerOptions).toMatchObject({
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    erasableSyntaxOnly: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noEmit: true,
  });
});

test("every workspace extends the shared baseline", () => {
  for (const workspace of [
    "apps/server",
    "apps/web",
    "apps/cli",
    "packages/contracts",
    "packages/client",
  ]) {
    expect(readJson(`${workspace}/tsconfig.json`).extends).toBe("../../tsconfig.base.json");
  }
});

test("browser configuration excludes Node-only types", () => {
  const web = readJson("apps/web/tsconfig.json");
  expect(web.compilerOptions.types).toEqual(["vite/client"]);
  expect(web.compilerOptions.types).not.toContain("node");
  expect(web.compilerOptions.types).not.toContain("bun");
  expect(web.compilerOptions.lib).toContain("DOM");

  for (const workspace of ["packages/contracts", "packages/client"]) {
    expect(readJson(`${workspace}/tsconfig.json`).compilerOptions.types).toEqual([]);
  }
});
