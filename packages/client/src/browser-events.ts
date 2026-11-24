import {
  BadRequest,
  FoundationEvent,
  ServiceUnavailable,
  TransportError,
} from "@openteam/contracts";
import { Schema } from "effect";
import * as Sse from "effect/encoding/Sse";
import type { Fetch } from "./index.ts";

export type EventConnectionError = BadRequest | ServiceUnavailable | TransportError;

export type EventConnectionState =
  | { readonly status: "connecting" }
  | {
      readonly status: "connected";
      /** Unique Events received on this connection, including replayed Events. */
      readonly replayed: number;
      readonly lastCursor: string | undefined;
    }
  | { readonly status: "disconnected" }
  | { readonly status: "error"; readonly error: EventConnectionError };

export interface EventConnectionOptions {
  readonly baseUrl?: string | undefined;
  readonly fetch?: Fetch | undefined;
  readonly cursor?: string | undefined;
  readonly onEvent?: ((event: FoundationEvent) => void) | undefined;
  readonly onState: (state: EventConnectionState) => void;
}

export interface EventConnection {
  close: () => void;
}

interface EventStreamReader {
  read: () => Promise<{ readonly done: boolean; readonly value?: Uint8Array | undefined }>;
  cancel: () => Promise<void>;
  releaseLock: () => void;
}

/** Connect the browser to durable Events without embedding an Effect runtime. */
export function connectEvents(options: EventConnectionOptions): EventConnection {
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  const fetch = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const seen = new Set<string>();
  let replayed = 0;
  let lastCursor = options.cursor;
  let reader: EventStreamReader | undefined;
  let closed = false;
  const parser = Sse.makeParser((frame) => {
    if (frame._tag !== "Event" || frame.event !== "openteam") {
      return;
    }
    const event = Schema.decodeUnknownSync(FoundationEvent)(JSON.parse(frame.data));
    if (frame.id !== event.cursor) {
      throw new TransportError({ message: "OpenTeam returned a mismatched Event cursor" });
    }
    if (seen.has(event.cursor)) {
      return;
    }
    seen.add(event.cursor);
    replayed += 1;
    lastCursor = event.cursor;
    options.onState({ status: "connected", replayed, lastCursor });
    options.onEvent?.(event);
  });

  options.onState({ status: "connecting" });

  const run = async () => {
    try {
      const response = await fetch(`${baseUrl}/v1/events`, {
        headers: {
          Accept: "text/event-stream",
          ...(options.cursor === undefined ? {} : { "Last-Event-ID": options.cursor }),
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 400 || response.status === 503) {
        const body: unknown = await response.json();
        throw response.status === 400
          ? Schema.decodeUnknownSync(BadRequest)(body)
          : Schema.decodeUnknownSync(ServiceUnavailable)(body);
      }
      if (response.status !== 200) {
        throw new TransportError({
          message: `OpenTeam returned unexpected Event stream HTTP status ${response.status}`,
        });
      }
      if (!response.headers.get("content-type")?.includes("text/event-stream")) {
        throw new TransportError({
          message: "OpenTeam returned an invalid Event stream content type",
        });
      }
      if (response.body === null) {
        throw new TransportError({ message: "OpenTeam returned an empty Event stream body" });
      }
      const streamReader = response.body.getReader();
      reader = streamReader;
      options.onState({ status: "connected", replayed, lastCursor });
      const decoder = new TextDecoder();
      while (!controller.signal.aborted) {
        const chunk = await streamReader.read();
        if (chunk.done) {
          const error = parser.feed(decoder.decode());
          if (error !== undefined) {
            throw new TransportError({ message: error.message, cause: error });
          }
          break;
        }
        const error = parser.feed(decoder.decode(chunk.value, { stream: true }));
        if (error !== undefined) {
          throw new TransportError({ message: error.message, cause: error });
        }
      }
      if (!controller.signal.aborted) {
        options.onState({ status: "disconnected" });
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        options.onState({
          status: "error",
          error:
            cause instanceof BadRequest ||
            cause instanceof ServiceUnavailable ||
            cause instanceof TransportError
              ? cause
              : new TransportError({ message: "OpenTeam returned an invalid Event stream", cause }),
        });
      }
    } finally {
      reader?.releaseLock();
    }
  };

  void run();

  return {
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      options.onState({ status: "disconnected" });
    },
  };
}
