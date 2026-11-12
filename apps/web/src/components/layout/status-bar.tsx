import { Link } from "react-router"
import { adapters } from "@/adapters"
import {
  useAdapterStates,
  useChannelStats,
  useLatestWebhook,
} from "@/api/hooks"
import { formatCount } from "@/channels/inbox-pane"
import { cn } from "@/lib/utils"
import { Time } from "../bits"

/** IDE-style footer: what's listening, where webhooks go, how much is stored. */
export function StatusBar() {
  const states = useAdapterStates()
  const stats = useChannelStats().data ?? []
  const lastHook = useLatestWebhook().data
  const lastOk = lastHook && lastHook.status !== null && lastHook.status < 400
  const inboxes = stats.reduce((n, s) => n + s.inboxes, 0)
  const items = stats.reduce((n, s) => n + s.items, 0)

  return (
    <footer className="hidden h-7 shrink-0 items-center gap-4 border-t bg-sidebar px-3 font-mono text-[10.5px] text-muted-foreground md:flex">
      {adapters.map((a) => (
        <Link
          key={a.id}
          to={`/adapters/${a.id}`}
          className="flex items-center gap-1.5 hover:text-foreground"
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              states[a.id]?.enabled ? "bg-ok" : "bg-muted-foreground/40"
            )}
          />
          {a.id} :{a.port}
        </Link>
      ))}
      <span className="h-3 w-px bg-border" />
      {lastHook ? (
        <Link
          to={`/webhooks?id=${lastHook.id}`}
          className="flex min-w-0 items-center gap-1.5 hover:text-foreground"
        >
          <span
            className={cn(
              lastOk ? "text-[color:var(--ok)]" : "text-destructive"
            )}
          >
            {lastHook.status ?? "ERR"}
          </span>
          <span className="truncate">{lastHook.event}</span>
          <Time iso={lastHook.createdAt} />
        </Link>
      ) : null}
      <span className="flex-1" />
      <span className="tabular-nums">
        in-memory · {formatCount(inboxes)} inboxes · {formatCount(items)} items
      </span>
    </footer>
  )
}
