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

```sh
bun run dev
```

This starts the Bun server workspace and the Vite web application. The web development server proxies `/v1` requests to `http://127.0.0.1:3000` by default; set `OPENTEAM_PROXY_TARGET` to override that target.

See [GLOSSARY.md](GLOSSARY.md) and [the architecture decisions](docs/adr/) for domain language and package boundaries.
