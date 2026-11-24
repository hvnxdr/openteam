# OpenTeam

OpenTeam is a self-hosted control plane for tracking team work and coordinating agent runs.

The repository is a Bun monorepo managed with Vite+:

| Workspace            | Responsibility                                               |
| -------------------- | ------------------------------------------------------------ |
| `apps/server`        | HTTP services, persistence, transactions, and Event delivery |
| `apps/web`           | React and TanStack browser application                       |
| `apps/cli`           | `openteam` operational command-line entry point              |
| `packages/contracts` | Shared Effect Schema wire contracts only                     |
| `packages/client`    | Browser-safe Promise client and typed client adapters        |

Clients depend on `@openteam/contracts`; they do not import server, Drizzle, or SQLite internals. The web app uses the Promise client and does not embed the Effect runtime.

## Prerequisites

- Bun 1.4.5 (pinned by `devEngines.packageManager`)
- A Vite+-compatible Node.js version for tooling: `^22.18.0 || ^24.11.0 || >=26.0.0`

## Install and validate

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run build
```

`check` runs Vite+ formatting, linting, and type checking. `test` runs Bun tests, and `build` runs every workspace build in dependency order. `bun run ready` composes all three commands.

## Development

Upgrade a local data directory explicitly before starting the server:

```sh
bun run apps/cli/src/index.ts upgrade --data-dir ./data
bun run dev
```

`upgrade` applies committed Drizzle artifacts transactionally and is a successful no-op when the database is already current. `serve` and the direct development entry point never create or alter the schema; they exit nonzero with an upgrade instruction when the database is missing or incompatible.

Server configuration can be supplied through environment variables or `openteam serve` flags. Flags take precedence.

| Environment variable     | CLI flag          | Default                                             |
| ------------------------ | ----------------- | --------------------------------------------------- |
| `OPENTEAM_HOST`          | `--host`          | `127.0.0.1`                                         |
| `OPENTEAM_PORT`          | `--port`          | `3000`                                              |
| `OPENTEAM_DATA_DIR`      | `--data-dir`      | Platform-standard per-human OpenTeam data directory |
| `OPENTEAM_DATABASE_PATH` | `--database-path` | `<data-dir>/openteam.db`                            |
| `OPENTEAM_PROXY_TARGET`  | —                 | `http://127.0.0.1:3000`                             |

The Bun server and Vite web application start together with `bun run dev`. The browser uses a same-origin Promise client, and Vite proxies `/v1` requests to the Effect server. Operational logs are structured JSON on stderr and exclude request bodies and secrets.

See [GLOSSARY.md](GLOSSARY.md) and [the architecture decisions](docs/adr/) for domain language and package boundaries.
