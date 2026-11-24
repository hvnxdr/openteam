import { expect, test } from "bun:test";
import { Schema } from "effect";
import { BadRequest, FoundationEvent, TransportError } from "@openteam/contracts";
import { connectEvents, type EventConnectionState, type Fetch } from "../src/index.ts";

function eventFrame(cursor: string, message: string) {
  const event: FoundationEvent = {
    cursor,
    type: "foundation.probe.created",
    occurredAt: "2026-11-24T10:00:00.000Z",
    payload: {
      probeId: `prb_${cursor}`,
      message,
      createdAt: "2026-11-24T10:00:00.000Z",
    },
  };
  return `id: ${cursor}\nevent: openteam\ndata: ${JSON.stringify(event)}\n\n`;
}

test("the browser adapter reports replay state, deduplicates cursors, and cancels on close", async () => {
  const states: Array<EventConnectionState> = [];
  const received: Array<FoundationEvent> = [];
  const requests: Array<{ input: string | URL | Request; init: RequestInit | undefined }> = [];
  let cancelled = false;
  let resolveSecond: (() => void) | undefined;
  const secondEvent = new Promise<void>((resolve) => {
    resolveSecond = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const wire = `: keepalive\n\n${eventFrame("evt_1", "First")}${eventFrame(
        "evt_1",
        "Duplicate",
      )}${eventFrame("evt_2", "Second")}`;
      const bytes = new TextEncoder().encode(wire);
      for (let offset = 0; offset < bytes.length; offset += 7) {
        controller.enqueue(bytes.slice(offset, offset + 7));
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetch: Fetch = (input, init) => {
    requests.push({ input, init });
    return Promise.resolve(
      new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
  };

  const connection = connectEvents({
    baseUrl: "http://127.0.0.1:3000/",
    fetch,
    cursor: "opaque-previous",
    onState: (state) => states.push(state),
    onEvent: (event) => {
      received.push(Schema.decodeUnknownSync(FoundationEvent)(event));
      if (event.cursor === "evt_2") {
        resolveSecond?.();
      }
    },
  });
  await secondEvent;

  expect(requests[0]?.input).toBe("http://127.0.0.1:3000/v1/events");
  expect(new Headers(requests[0]?.init?.headers).get("Accept")).toBe("text/event-stream");
  expect(new Headers(requests[0]?.init?.headers).get("Last-Event-ID")).toBe("opaque-previous");
  expect(received.map((event) => event.cursor)).toEqual(["evt_1", "evt_2"]);
  expect(states).toContainEqual({ status: "connecting" });
  expect(states).toContainEqual({
    status: "connected",
    replayed: 2,
    lastCursor: "evt_2",
  });

  connection.close();
  await Promise.resolve();

  expect(cancelled).toBe(true);
  expect(requests[0]?.init?.signal?.aborted).toBe(true);
});

test("the browser adapter surfaces typed cursor errors", async () => {
  let resolveState: ((state: EventConnectionState) => void) | undefined;
  const terminalState = new Promise<EventConnectionState>((resolve) => {
    resolveState = resolve;
  });
  const fetch: Fetch = () =>
    Promise.resolve(
      Response.json(
        { _tag: "BadRequest", code: "invalid_cursor", message: "Invalid cursor" },
        { status: 400 },
      ),
    );

  const connection = connectEvents({
    fetch,
    cursor: "invalid",
    onState: (state) => {
      if (state.status === "error") {
        resolveState?.(state);
      }
    },
  });
  const state = await terminalState;

  expect(state.status).toBe("error");
  if (state.status !== "error") {
    throw new Error("Expected an Event connection error");
  }
  expect(state.error).toBeInstanceOf(BadRequest);
  connection.close();
});

test("the browser adapter reports network failures as transport errors", async () => {
  let resolveState: ((state: EventConnectionState) => void) | undefined;
  const terminalState = new Promise<EventConnectionState>((resolve) => {
    resolveState = resolve;
  });
  const fetch: Fetch = () => Promise.reject(new Error("offline"));

  const connection = connectEvents({
    fetch,
    onState: (state) => {
      if (state.status === "error") {
        resolveState?.(state);
      }
    },
  });
  const state = await terminalState;

  expect(state.status).toBe("error");
  if (state.status !== "error") {
    throw new Error("Expected an Event connection error");
  }
  expect(state.error).toBeInstanceOf(TransportError);
  connection.close();
});
