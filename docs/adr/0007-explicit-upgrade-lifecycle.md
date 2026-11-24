# Explicit upgrade lifecycle

Database schema changes, safe backfills, projection rebuilds, and persisted contract compatibility are applied through `openteam upgrade`, not a separate migrate command or silent startup mutation. Drizzle Kit generates the artifacts and the server applies them under a lock with `--check` and `--dry-run` support. Explicit upgrades make backups, failure recovery, and automated release procedures predictable for self-hosted installations.
