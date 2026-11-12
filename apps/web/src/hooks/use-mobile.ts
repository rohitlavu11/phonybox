import * as React from "react"

export function useMediaQuery(query: string) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query]
  )
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}

/** < 768px: one pane at a time. */
export const useIsMobile = () => useMediaQuery("(max-width: 767px)")

/** >= 1400px: room for the inbox column next to list and detail. */
export const useIsWide = () => useMediaQuery("(min-width: 1400px)")
