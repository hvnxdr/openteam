import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  connectEvents,
  type createClient,
  type EventConnectionState,
  type HealthResponse,
  type ProbeSummary,
} from "@openteam/client";

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FoundationRoute,
});

type OpenTeamClient = ReturnType<typeof createClient>;

export interface FoundationAppProps {
  client: OpenTeamClient;
}

export function FoundationApp({ client }: FoundationAppProps) {
  const [queryClient] = useState(() => new QueryClient());
  const [router] = useState(() =>
    createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      context: { client },
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export type EventConnectionViewProps = {
  readonly state: EventConnectionState;
};

export function EventConnectionView({ state }: EventConnectionViewProps) {
  if (state.status === "connecting") {
    return (
      <p role="status" aria-live="polite">
        Connecting to the Event stream…
      </p>
    );
  }
  if (state.status === "disconnected") {
    return (
      <p role="status" aria-live="polite">
        Event stream disconnected.
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert">
        <p>Event stream unavailable. {state.error.message}</p>
      </div>
    );
  }
  return (
    <p role="status" aria-live="polite">
      Event stream connected. {`Events replayed/received: ${state.replayed}.`}{" "}
      {state.lastCursor === undefined ? (
        "No Events received yet."
      ) : (
        <>
          Last Event cursor: <code>{state.lastCursor}</code>
        </>
      )}
    </p>
  );
}

export type ProbeListViewProps =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly retry: () => void }
  | { readonly state: "success"; readonly probes: ReadonlyArray<ProbeSummary> };

export function ProbeListView(props: ProbeListViewProps) {
  if (props.state === "loading") {
    return (
      <p role="status" aria-live="polite">
        Loading foundation probes…
      </p>
    );
  }
  if (props.state === "error") {
    return (
      <div role="alert">
        <p>Foundation probes are unavailable.</p>
        <button type="button" onClick={props.retry}>
          Try again
        </button>
      </div>
    );
  }
  if (props.probes.length === 0) {
    return <p>No foundation probes yet.</p>;
  }
  return (
    <ul aria-label="Foundation probes">
      {props.probes.map((probe) => (
        <li key={probe.id}>
          <p>{probe.message}</p>
          <time dateTime={probe.createdAt}>{probe.createdAt}</time>
        </li>
      ))}
    </ul>
  );
}

export type HealthViewProps =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly retry: () => void }
  | { readonly state: "success"; readonly health: HealthResponse };

export function HealthView(props: HealthViewProps) {
  if (props.state === "loading") {
    return (
      <p role="status" aria-live="polite">
        Checking database readiness…
      </p>
    );
  }
  if (props.state === "error") {
    return (
      <div role="alert">
        <p>Database readiness is unavailable.</p>
        <button type="button" onClick={props.retry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <p role="status">
      Database ready <span>(server {props.health.version})</span>
    </p>
  );
}

function useEventConnection(client: OpenTeamClient) {
  const [state, setState] = useState<EventConnectionState>({ status: "connecting" });
  useEffect(() => {
    let active = true;
    const connection = connectEvents({
      baseUrl: client.baseUrl,
      fetch: client.fetch,
      onState: (next) => {
        if (active) {
          setState(next);
        }
      },
    });
    return () => {
      active = false;
      connection.close();
    };
  }, [client]);
  return state;
}

function FoundationRoute() {
  const { client } = indexRoute.useRouteContext();
  const eventConnection = useEventConnection(client);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => client.health(),
    retry: 1,
  });
  const probes = useQuery({
    queryKey: ["foundation", "probes"],
    queryFn: () => client.listProbes({ limit: 20 }),
    retry: 1,
  });

  return (
    <main>
      <h1>OpenTeam</h1>
      <p>Foundation compatibility view. This is not the product dashboard.</p>
      {health.isPending ? (
        <HealthView state="loading" />
      ) : health.isError ? (
        <HealthView state="error" retry={() => void health.refetch()} />
      ) : (
        <HealthView state="success" health={health.data} />
      )}
      <section aria-labelledby="event-synchronization-heading">
        <h2 id="event-synchronization-heading">Event synchronization</h2>
        <EventConnectionView state={eventConnection} />
      </section>
      <section aria-labelledby="foundation-probes-heading">
        <h2 id="foundation-probes-heading">Foundation probes</h2>
        {probes.isPending ? (
          <ProbeListView state="loading" />
        ) : probes.isError ? (
          <ProbeListView state="error" retry={() => void probes.refetch()} />
        ) : (
          <ProbeListView state="success" probes={probes.data.probes} />
        )}
      </section>
    </main>
  );
}
