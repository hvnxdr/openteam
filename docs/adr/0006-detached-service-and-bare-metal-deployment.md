# Detached service and bare-metal deployment

The default background mode is a detached per-user `openteam serve --service` process with a registration file, health checks, structured logs, and an exclusive data-directory lock. It requires neither sudo nor systemd lingering; an optional systemd user unit supports always-on VPS deployments. OpenTeam will not use Docker in v0: Bun, Caddy, persistent SQLite storage, and an optional service manager are sufficient for self-hosting.
