import { useEffect } from "react"
import { useRouter } from "@tanstack/react-router"

function internalHref(anchor: HTMLAnchorElement): string | null {
  if (
    anchor.target !== "" ||
    anchor.hasAttribute("download") ||
    anchor.getAttribute("rel")?.split(/\s+/).includes("external")
  ) {
    return null
  }

  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) {
    return null
  }
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search &&
    url.hash !== ""
  ) {
    return null
  }
  return `${url.pathname}${url.search}${url.hash}`
}

function workspaceAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest<HTMLAnchorElement>("a[href]")
  if (anchor === null || anchor.closest(".change-review-shell") === null) {
    return null
  }
  return anchor
}

/**
 * Preserve the plain anchors used by the server-rendered evidence views while
 * upgrading them to TanStack Router navigation after hydration. This keeps
 * back/forward and copyable URLs, but tab and record changes reuse the cached
 * Incident projection instead of downloading a new document.
 */
export function FastWorkspaceNavigation() {
  const router = useRouter()

  useEffect(() => {
    const preloaded = new Set<string>()

    const preload = (target: EventTarget | null) => {
      const anchor = workspaceAnchor(target)
      if (anchor === null) return
      const href = internalHref(anchor)
      if (href === null || preloaded.has(href)) return
      preloaded.add(href)
      void router.preloadRoute({ to: href }).catch(() => {
        preloaded.delete(href)
      })
    }

    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const anchor = workspaceAnchor(event.target)
      if (anchor === null) return
      const href = internalHref(anchor)
      if (href === null) return
      event.preventDefault()
      void router.navigate({ href, resetScroll: false })
    }

    const preloadFromEvent = (event: Event) => preload(event.target)

    document.addEventListener("click", navigate)
    document.addEventListener("pointerover", preloadFromEvent)
    document.addEventListener("focusin", preloadFromEvent)

    const eagerPreload = window.setTimeout(() => {
      document
        .querySelectorAll<HTMLAnchorElement>(
          ".change-review-shell .cr-incident-option[href]"
        )
        .forEach((anchor) => preload(anchor))
    }, 200)

    return () => {
      window.clearTimeout(eagerPreload)
      document.removeEventListener("click", navigate)
      document.removeEventListener("pointerover", preloadFromEvent)
      document.removeEventListener("focusin", preloadFromEvent)
    }
  }, [router])

  return null
}
