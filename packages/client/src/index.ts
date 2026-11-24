import {
  BadRequest,
  CreateProbeRequest,
  CreateProbeResponse,
  HealthResponse,
  IdempotencyConflict,
  ListProbesRequest,
  ListProbesResponse,
  ServiceUnavailable,
  TransportError,
} from "@openteam/contracts";
import { Schema } from "effect";

export type {
  BadRequest,
  CreateProbeRequest,
  CreateProbeResponse,
  HealthResponse,
  IdempotencyConflict,
  ListProbesRequest,
  ListProbesResponse,
  OpenTeamError,
  ProbeSummary,
  ServiceUnavailable,
  TransportError,
} from "@openteam/contracts";

/** Default transport used by the browser-safe Promise client. */
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  baseUrl?: string;
  fetch?: Fetch;
}

/** Construct a same-origin client unless a server URL is explicitly supplied. */
export function createClient(options: ClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const fetch = options.fetch ?? globalThis.fetch;

  return {
    baseUrl,
    fetch,
    async createProbe(input: { readonly message: string; readonly idempotencyKey: string }) {
      const payload = Schema.encodeUnknownSync(CreateProbeRequest)({ message: input.message });
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/foundation/probes`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Idempotency-Key": input.idempotencyKey,
          },
          body: JSON.stringify(payload),
        });
      } catch (cause) {
        throw new TransportError({ message: "Unable to reach the OpenTeam server", cause });
      }
      try {
        const body: unknown = await response.json();
        if (response.status === 400) {
          throw Schema.decodeUnknownSync(BadRequest)(body);
        }
        if (response.status === 409) {
          throw Schema.decodeUnknownSync(IdempotencyConflict)(body);
        }
        if (response.status === 503) {
          throw Schema.decodeUnknownSync(ServiceUnavailable)(body);
        }
        if (response.status === 200 || response.status === 201) {
          return Schema.decodeUnknownSync(CreateProbeResponse)(body);
        }
        throw new TransportError({
          message: `OpenTeam returned unexpected HTTP status ${response.status}`,
        });
      } catch (cause) {
        if (
          cause instanceof BadRequest ||
          cause instanceof IdempotencyConflict ||
          cause instanceof ServiceUnavailable ||
          cause instanceof TransportError
        ) {
          throw cause;
        }
        throw new TransportError({
          message: "OpenTeam returned an invalid create response",
          cause,
        });
      }
    },
    async listProbes(options: ListProbesRequest = {}) {
      const request = Schema.encodeUnknownSync(ListProbesRequest)(options);
      const query = new URLSearchParams();
      if (request.limit !== undefined) {
        query.set("limit", String(request.limit));
      }
      if (request.cursor !== undefined) {
        query.set("cursor", request.cursor);
      }
      const suffix = query.size === 0 ? "" : `?${query.toString()}`;
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/foundation/probes${suffix}`, {
          headers: { Accept: "application/json" },
        });
      } catch (cause) {
        throw new TransportError({ message: "Unable to reach the OpenTeam server", cause });
      }
      try {
        const body: unknown = await response.json();
        if (response.status === 400) {
          throw Schema.decodeUnknownSync(BadRequest)(body);
        }
        if (response.status === 503) {
          throw Schema.decodeUnknownSync(ServiceUnavailable)(body);
        }
        if (response.status === 200) {
          return Schema.decodeUnknownSync(ListProbesResponse)(body);
        }
        throw new TransportError({
          message: `OpenTeam returned unexpected HTTP status ${response.status}`,
        });
      } catch (cause) {
        if (
          cause instanceof BadRequest ||
          cause instanceof ServiceUnavailable ||
          cause instanceof TransportError
        ) {
          throw cause;
        }
        throw new TransportError({
          message: "OpenTeam returned an invalid list response",
          cause,
        });
      }
    },
    async health() {
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/health`, {
          headers: { Accept: "application/json" },
        });
      } catch (cause) {
        throw new TransportError({ message: "Unable to reach the OpenTeam server", cause });
      }
      try {
        const body: unknown = await response.json();
        if (response.status === 503) {
          throw Schema.decodeUnknownSync(ServiceUnavailable)(body);
        }
        if (response.status !== 200) {
          throw new TransportError({
            message: `OpenTeam returned unexpected HTTP status ${response.status}`,
          });
        }
        return Schema.decodeUnknownSync(HealthResponse)(body);
      } catch (cause) {
        if (cause instanceof TransportError || cause instanceof ServiceUnavailable) {
          throw cause;
        }
        throw new TransportError({
          message: "OpenTeam returned an invalid health response",
          cause,
        });
      }
    },
  };
}
