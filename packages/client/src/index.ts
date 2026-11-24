export type { OpenTeamError, TransportError } from "@openteam/contracts";

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
  };
}
