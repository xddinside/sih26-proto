import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,

    scrollRestoration: true,
    defaultPreload: "intent",
    // Saved Demo Runs do not change during a browser session. Keep every
    // visited or preloaded Incident hot until the page itself is closed.
    defaultStaleTime: Infinity,
    defaultPreloadStaleTime: Infinity,
    defaultGcTime: Infinity,
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
