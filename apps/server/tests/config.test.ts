import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveDatabaseConfig, resolveServerConfig } from "../src/config.ts";

describe("server configuration", () => {
  test("defaults to loopback and supports environment configuration", () => {
    const config = resolveServerConfig(
      {},
      {
        OPENTEAM_HOST: "0.0.0.0",
        OPENTEAM_PORT: "4100",
        OPENTEAM_DATA_DIR: "/tmp/openteam-env",
      },
    );

    expect(config).toEqual({
      host: "0.0.0.0",
      port: 4100,
      dataDir: "/tmp/openteam-env",
      databasePath: "/tmp/openteam-env/openteam.db",
    });
  });

  test("explicit options override environment values", () => {
    const config = resolveServerConfig(
      { host: "127.0.0.1", port: 4200, dataDir: "/tmp/openteam-flags" },
      { OPENTEAM_HOST: "0.0.0.0", OPENTEAM_PORT: "4100", OPENTEAM_DATA_DIR: "/tmp/openteam-env" },
    );

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(4200);
    expect(config.dataDir).toBe("/tmp/openteam-flags");
  });

  test("uses a platform data subdirectory rather than the XDG root", () => {
    if (process.platform !== "linux") return;
    const config = resolveServerConfig({}, { XDG_DATA_HOME: "/tmp/openteam-xdg" });

    expect(config.dataDir).toBe(join("/tmp/openteam-xdg", "openteam"));
  });

  test("rejects an invalid port", () => {
    expect(() => resolveServerConfig({}, { OPENTEAM_PORT: "70000" })).toThrow(
      "OPENTEAM_PORT must be an integer between 0 and 65535",
    );
  });

  test("database-only operations ignore server host and port configuration", () => {
    const config = resolveDatabaseConfig(
      { dataDir: "/tmp/openteam-upgrade" },
      { OPENTEAM_PORT: "not-a-port", OPENTEAM_HOST: "0.0.0.0" },
    );

    expect(config).toEqual({
      dataDir: "/tmp/openteam-upgrade",
      databasePath: "/tmp/openteam-upgrade/openteam.db",
    });
  });
});
