# Durable events and SSE synchronization

Every mutation will transactionally update its projection, append a sequenced event, and record its command receipt. Clients reconnect to `/v1/events` with a cursor, replay missed events, and invalidate affected queries; commands continue to use HTTP JSON. Durable replay is required because issue and run state must remain trustworthy across disconnects, unlike volatile live-only event streams. WebSocket RPC can be added later if bidirectional streaming becomes necessary.
