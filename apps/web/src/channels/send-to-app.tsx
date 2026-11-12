import * as React from "react"
import { ArrowDownLeftIcon } from "lucide-react"
import { getAdapter } from "@/adapters"
import { useAdapterStates } from "@/api/hooks"
import type { Inbox } from "@/types/domain"
import { getChannel } from "@/channels/meta"
import { AdapterMark } from "@/components/bits"

/**
 * Footer shown in every "send to app" composer. Makes the inbound adapter
 * explicit: which webhook fires, and where it goes.
 */
export function InboundRoute({
  inbox,
  event,
  urlKey,
}: {
  inbox: Inbox
  event: string
  urlKey: string
}) {
  const states = useAdapterStates()
  const adapter = getAdapter(inbox.adapterId)
  const url = String(states[inbox.adapterId]?.values[urlKey] ?? "")
  const enabled = states[inbox.adapterId]?.enabled

  return (
    <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
      <ArrowDownLeftIcon className="size-3.5 shrink-0" aria-hidden />
      <AdapterMark id={inbox.adapterId} className="size-4 text-[9px]" />
      <span className="min-w-0 truncate">
        {enabled ? (
          <>
            {adapter?.name} <code className="text-foreground">{event}</code> →{" "}
            <code>{url || "no URL set"}</code>
          </>
        ) : (
          <>{adapter?.name} adapter is off. Turn it on to deliver this.</>
        )}
      </span>
    </div>
  )
}

export function fromLabel(inbox: Inbox) {
  const meta = getChannel(inbox.channel)
  return inbox.catchAll
    ? "someone@inbox.test"
    : meta.formatAddress(inbox.address)
}

export function useHotkey(
  key: string,
  handler: (e: KeyboardEvent) => void,
  enabled = true
) {
  const ref = React.useRef(handler)
  React.useLayoutEffect(() => {
    ref.current = handler
  })
  React.useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t?.closest(
          "input, textarea, select, [contenteditable='true'], [role='dialog']"
        )
      )
        return
      if (e.key === key) {
        e.preventDefault()
        ref.current(e)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [key, enabled])
}
