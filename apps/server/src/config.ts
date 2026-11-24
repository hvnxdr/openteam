import { homedir } from "node:os";
import { join } from "node:path";

export interface DatabaseConfig {
  readonly dataDir: string;
  readonly databasePath: string;
}

export interface ServerConfig extends DatabaseConfig {
  readonly host: string;
  readonly port: number;
}

export interface ServerConfigOverrides {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly dataDir?: string | undefined;
  readonly databasePath?: string | undefined;
}

export function defaultDataDirectory(env: NodeJS.ProcessEnv = process.env) {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "OpenTeam");
  }
  if (process.platform === "win32") {
    return join(env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "OpenTeam");
  }
  return join(env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "openteam");
}

export function resolveDatabaseConfig(
  overrides: Pick<ServerConfigOverrides, "dataDir" | "databasePath"> = {},
  env = process.env,
): DatabaseConfig {
  const dataDir = overrides.dataDir ?? env["OPENTEAM_DATA_DIR"] ?? defaultDataDirectory(env);
  return {
    dataDir,
    databasePath:
      overrides.databasePath ?? env["OPENTEAM_DATABASE_PATH"] ?? join(dataDir, "openteam.db"),
  };
}

export function resolveServerConfig(
  overrides: ServerConfigOverrides = {},
  env = process.env,
): ServerConfig {
  const database = resolveDatabaseConfig(overrides, env);
  const port = overrides.port ?? Number(env["OPENTEAM_PORT"] ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("OPENTEAM_PORT must be an integer between 0 and 65535");
  }
  return {
    host: overrides.host ?? env["OPENTEAM_HOST"] ?? "127.0.0.1",
    port,
    ...database,
  };
}
