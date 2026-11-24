import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";
import type { createClient, HealthResponse } from "@openteam/client";

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

function FoundationRoute() {
  const { client } = indexRoute.useRouteContext();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => client.health(),
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
    </main>
  );
}
