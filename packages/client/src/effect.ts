import {
  BadRequest,
  FoundationEvent,
  ServiceUnavailable,
  TransportError,
} from "@openteam/contracts";
import { Effect, Function, Schema, Stream } from "effect";
import * as Sse from "effect/encoding/Sse";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

const OpenTeamSseEvent = Schema.Struct({
  id: Schema.String,
  event: Schema.Literal("openteam"),
  data: Schema.fromJsonString(FoundationEvent),
});

export interface EventStreamOptions {
  readonly baseUrl?: string | undefined;
  readonly cursor?: string | undefined;
}

export type EventStreamError = BadRequest | ServiceUnavailable | TransportError;

/** Open a typed durable Event stream, optionally resuming after an opaque cursor. */
export function eventStream(
  client: HttpClient.HttpClient,
  options: EventStreamOptions = {},
): Stream.Stream<FoundationEvent, EventStreamError> {
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  const request = HttpClientRequest.get(`${baseUrl}/v1/events`).pipe(
    HttpClientRequest.setHeader("Accept", "text/event-stream"),
    options.cursor === undefined
      ? Function.identity
      : HttpClientRequest.setHeader("Last-Event-ID", options.cursor),
  );

  return Stream.unwrap<FoundationEvent, EventStreamError, never, TransportError, never>(
    Effect.gen(function* () {
      const response = yield* client
        .execute(request)
        .pipe(
          Effect.mapError(
            (cause) =>
              new TransportError({ message: "Unable to reach the OpenTeam Event stream", cause }),
          ),
        );
      if (response.status === 400) {
        const error = yield* response.json.pipe(
          Effect.flatMap((body) => Schema.decodeUnknownEffect(BadRequest)(body)),
          Effect.mapError(
            (cause) =>
              new TransportError({ message: "OpenTeam returned an invalid Event error", cause }),
          ),
        );
        return Stream.fail(error);
      }
      if (response.status === 503) {
        const error = yield* response.json.pipe(
          Effect.flatMap((body) => Schema.decodeUnknownEffect(ServiceUnavailable)(body)),
          Effect.mapError(
            (cause) =>
              new TransportError({ message: "OpenTeam returned an invalid Event error", cause }),
          ),
        );
        return Stream.fail(error);
      }
      if (response.status !== 200) {
        return Stream.fail(
          new TransportError({
            message: `OpenTeam returned unexpected Event stream HTTP status ${response.status}`,
          }),
        );
      }
      if (!response.headers["content-type"]?.includes("text/event-stream")) {
        return Stream.fail(
          new TransportError({ message: "OpenTeam returned an invalid Event stream content type" }),
        );
      }
      return HttpClientResponse.stream(Effect.succeed(response)).pipe(
        Stream.decodeText,
        Stream.pipeThroughChannel(Sse.decodeSchema(OpenTeamSseEvent)),
        Stream.map((frame) => frame.data),
        Stream.mapError(
          (cause) =>
            new TransportError({ message: "OpenTeam returned an invalid Event stream", cause }),
        ),
      );
    }),
  );
}
