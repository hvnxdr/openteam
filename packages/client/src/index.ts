import { HealthResponse, ServiceUnavailable, TransportError } from "@openteam/contracts";
import { Schema } from "effect";

export type {
  HealthResponse,
  OpenTeamError,
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
