import { FoundationEvent, ServiceUnavailable } from "@openteam/contracts";
import { asc, gt } from "drizzle-orm";
import * as Drizzle from "drizzle-orm/effect-sqlite-bun";
import { Context, Effect, Layer, Option, Schema, Stream } from "effect";
import { events } from "./db/schema.ts";

export const EVENT_PAGE_SIZE = 100;
export const EVENT_POLL_INTERVAL = "25 millis" as const;

export const OpenTeamSseEvent = Schema.Struct({
  id: Schema.String,
  event: Schema.Literal("openteam"),
  data: Schema.fromJsonString(FoundationEvent),
});

export type OpenTeamSseEvent = typeof OpenTeamSseEvent.Type;

export class EventStore extends Context.Service<
  EventStore,
  {
    stream: (afterSeq: number) => Stream.Stream<OpenTeamSseEvent, ServiceUnavailable>;
  }
>()("openteam/server/EventStore") {
  static readonly layer = Layer.effect(
    EventStore,
    Effect.gen(function* () {
      const db = yield* Drizzle.makeWithDefaults();

      const readPage = (afterSeq: number) =>
        Effect.gen(function* () {
          const rows = yield* db
            .select({
              seq: events.seq,
              cursor: events.cursor,
              type: events.type,
              occurredAt: events.occurredAt,
              payloadJson: events.payloadJson,
            })
            .from(events)
            .where(gt(events.seq, afterSeq))
            .orderBy(asc(events.seq))
            .limit(EVENT_PAGE_SIZE);
          return yield* Effect.try({
            try: () => {
              const frames = rows.map((row) => {
                const event = Schema.decodeUnknownSync(FoundationEvent)({
                  cursor: row.cursor,
                  type: row.type,
                  occurredAt: row.occurredAt,
                  payload: JSON.parse(row.payloadJson),
                });
                return { id: event.cursor, event: "openteam", data: event } as const;
              });
              const last = rows.at(-1);
              return { frames, lastSeq: last?.seq ?? afterSeq };
            },
            catch: () => databaseUnavailable(),
          });
        }).pipe(Effect.catch(() => Effect.fail(databaseUnavailable())));

      return EventStore.of({
        stream: (afterSeq) =>
          Stream.paginate(afterSeq, (current) =>
            Effect.gen(function* () {
              const page = yield* readPage(current);
              if (page.frames.length === 0) {
                yield* Effect.sleep(EVENT_POLL_INTERVAL);
                return [[], Option.some(current)] as const;
              }
              return [page.frames, Option.some(page.lastSeq)] as const;
            }),
          ),
      });
    }),
  );
}

function databaseUnavailable() {
  return new ServiceUnavailable({
    code: "database_unavailable",
    message: "The database is unavailable.",
  });
}
