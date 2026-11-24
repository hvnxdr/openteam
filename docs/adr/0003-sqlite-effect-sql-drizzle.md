# SQLite with Effect SQL and Drizzle

OpenTeam will use SQLite in WAL mode through `@effect/sql-sqlite-bun`, with Drizzle providing typed schemas and queries behind Effect services and transactions. One team per installation does not justify an external database, while Drizzle keeps a large relational schema maintainable. Drizzle Kit generates upgrade artifacts, but the application applies them through its own explicit upgrade command.
