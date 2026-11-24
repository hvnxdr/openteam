import { createHash, randomUUID } from "node:crypto";
import {
  BadRequest,
  CreateProbeResponse,
  IdempotencyConflict,
  ListProbesResponse,
  ServiceUnavailable,
  type CreateProbeRequest,
  type ProbeSummary,
} from "@openteam/contracts";
import { desc, eq, lt } from "drizzle-orm";
import * as Drizzle from "drizzle-orm/effect-sqlite-bun";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";
import { commandReceipts, events, foundationProbes } from "./db/schema.ts";

export const DEFAULT_PROBE_PAGE_LIMIT = 20;
export const MAX_PROBE_PAGE_LIMIT = 100;
const CREATE_COMMAND = "foundation.probe.create";
const PAGE_CURSOR_PREFIX = "prb_page_";
const PageCursor = Schema.String.check(Schema.isPattern(/^prb_page_[1-9]\d*$/));

interface CreateProbeInput extends CreateProbeRequest {
  readonly idempotencyKey: string;
}

interface CreateProbeResult {
  readonly response: CreateProbeResponse;
  readonly retried: boolean;
}

export interface ListProbesOptions {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export class ProbeStore extends Context.Service<
  ProbeStore,
  {
    health: () => Effect.Effect<void, ServiceUnavailable>;
    create: (
      input: CreateProbeInput,
    ) => Effect.Effect<CreateProbeResult, IdempotencyConflict | ServiceUnavailable>;
    list: (
      options: ListProbesOptions,
    ) => Effect.Effect<ListProbesResponse, BadRequest | ServiceUnavailable>;
  }
>()("openteam/server/ProbeStore") {
  static readonly layer = Layer.effect(
    ProbeStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const db = yield* Drizzle.makeWithDefaults();

      const create = Effect.fnUntraced(
        function* (
          input: CreateProbeInput,
        ): Effect.fn.Return<
          CreateProbeResult,
          IdempotencyConflict | ServiceUnavailable | EffectDrizzleQueryError | SqlError
        > {
          const requestHash = hashRequest(input.message);
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const receipts = yield* db
                .select()
                .from(commandReceipts)
                .where(eq(commandReceipts.key, input.idempotencyKey))
                .limit(1);
              const receipt = receipts[0];
              if (receipt !== undefined) {
                if (receipt.command !== CREATE_COMMAND || receipt.requestHash !== requestHash) {
                  return yield* new IdempotencyConflict({
                    code: "idempotency_key_conflict",
                    message: "The idempotency key was already used for another command.",
                  });
                }
                const response = yield* Effect.try({
                  try: () =>
                    Schema.decodeUnknownSync(CreateProbeResponse)(JSON.parse(receipt.responseJson)),
                  catch: () => databaseUnavailable(),
                });
                return { response, retried: true };
              }

              const probe: ProbeSummary = {
                id: `prb_${randomUUID()}`,
                message: input.message,
                createdAt: DateTime.formatIso(yield* DateTime.now),
              };
              const [event] = yield* db
                .insert(events)
                .values({
                  cursor: `pending_${randomUUID()}`,
                  type: "foundation.probe.created",
                  occurredAt: probe.createdAt,
                  payloadJson: JSON.stringify({
                    probeId: probe.id,
                    message: probe.message,
                    createdAt: probe.createdAt,
                  }),
                })
                .returning({ seq: events.seq });
              if (event === undefined) {
                return yield* databaseUnavailable();
              }
              const eventCursor = `evt_${event.seq}`;
              yield* db
                .update(events)
                .set({ cursor: eventCursor })
                .where(eq(events.seq, event.seq));
              yield* db.insert(foundationProbes).values({ ...probe, eventSeq: event.seq });

              const response: CreateProbeResponse = { probe, eventCursor };
              yield* db.insert(commandReceipts).values({
                key: input.idempotencyKey,
                command: CREATE_COMMAND,
                requestHash,
                responseJson: JSON.stringify(response),
                responseStatus: 201,
                eventSeq: event.seq,
                createdAt: probe.createdAt,
              });
              return { response, retried: false };
            }),
          );
        },
        Effect.catch((cause): Effect.Effect<never, IdempotencyConflict | ServiceUnavailable> =>
          cause instanceof IdempotencyConflict
            ? Effect.fail(cause)
            : Effect.fail(databaseUnavailable()),
        ),
      );

      const list = Effect.fnUntraced(
        function* (
          options: ListProbesOptions,
        ): Effect.fn.Return<
          ListProbesResponse,
          BadRequest | ServiceUnavailable | EffectDrizzleQueryError
        > {
          const afterSeq =
            options.cursor === undefined ? undefined : parsePageCursor(options.cursor);
          if (options.cursor !== undefined && afterSeq === undefined) {
            return yield* new BadRequest({
              code: "invalid_cursor",
              message: "The probe pagination cursor is invalid.",
            });
          }
          const rows = yield* db
            .select({
              id: foundationProbes.id,
              message: foundationProbes.message,
              createdAt: foundationProbes.createdAt,
              seq: foundationProbes.seq,
            })
            .from(foundationProbes)
            .where(afterSeq === undefined ? undefined : lt(foundationProbes.seq, afterSeq))
            .orderBy(desc(foundationProbes.seq))
            .limit(options.limit + 1);
          const hasMore = rows.length > options.limit;
          const page = hasMore ? rows.slice(0, options.limit) : rows;
          const probes = page.map(({ id, message, createdAt }) => ({ id, message, createdAt }));
          const last = page.at(-1);
          return hasMore && last !== undefined
            ? { probes, nextCursor: `${PAGE_CURSOR_PREFIX}${last.seq}` }
            : { probes };
        },
        Effect.catch((cause): Effect.Effect<never, BadRequest | ServiceUnavailable> =>
          cause instanceof BadRequest ? Effect.fail(cause) : Effect.fail(databaseUnavailable()),
        ),
      );

      return ProbeStore.of({
        health: () =>
          sql`SELECT version FROM schema_version LIMIT 1`.pipe(
            Effect.asVoid,
            Effect.catch(() => Effect.fail(databaseUnavailable())),
          ),
        create,
        list,
      });
    }),
  );
}

function hashRequest(message: string) {
  return createHash("sha256")
    .update(JSON.stringify({ command: CREATE_COMMAND, version: 1, message }))
    .digest("hex");
}

function parsePageCursor(cursor: string) {
  return Option.getOrUndefined(
    Option.map(Schema.decodeUnknownOption(PageCursor)(cursor), (value) =>
      Number(value.slice(PAGE_CURSOR_PREFIX.length)),
    ),
  );
}

function databaseUnavailable() {
  return new ServiceUnavailable({
    code: "database_unavailable",
    message: "The database is unavailable.",
  });
}
