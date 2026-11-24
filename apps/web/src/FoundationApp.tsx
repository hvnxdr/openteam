import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { createClient } from "@openteam/client";

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FoundationRoute,
});

export interface FoundationAppProps {
  client: Pick<ReturnType<typeof createClient>, "baseUrl">;
}

export function FoundationApp({ client }: FoundationAppProps) {
  const queryClient = new QueryClient();
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    context: { client },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function FoundationRoute() {
  const { client } = indexRoute.useRouteContext();
  return (
    <main>
      <h1>OpenTeam</h1>
      <p>Foundation workspace. The compatibility view will appear here.</p>
      <p data-testid="client-base-url">{client.baseUrl}</p>
    </main>
  );
}
