# Server-owned client/server architecture

OpenTeam will expose one long-lived server that owns domain state, authorization, workflow policy, event history, and run coordination. The web app, CLI, agent SDK, and future MCP adapters are thin clients of shared contracts and call the same Effect services; clients never access SQLite or duplicate domain behavior. This follows the modern client/server model used by OpenCode and T3 Code and keeps every surface consistent.
