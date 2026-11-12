import * as React from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import {
  BlocksIcon,
  BotIcon,
  LayersIcon,
  MoonIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  SearchIcon,
  SettingsIcon,
  WebhookIcon,
} from "lucide-react"
import { adapters } from "@/adapters"
import { api } from "@/api/client"
import { useInboxes } from "@/api/hooks"
import { channels, getChannel } from "@/channels/meta"
import { UnreadBadge, formatCount } from "@/channels/inbox-pane"
import { useTheme } from "@/components/theme-provider"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { AdapterMark } from "../bits"

const RESULTS = 8

/**
 * Inbox search runs server-side and shows the top matches, so the menu stays
 * instant with any number of inboxes. Pages and actions filter locally.
 */
export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const [q, setQ] = React.useState("")
  const query = React.useDeferredValue(q.trim())
  const results = useInboxes({ q: query, sort: "activity" })
  const top = results.items.slice(0, RESULTS)

  const close = (o: boolean) => {
    if (!o) setQ("")
    onOpenChange(o)
  }
  const go = (to: string) => {
    close(false)
    navigate(to)
  }
  const matches = (label: string) =>
    !query || label.toLowerCase().includes(query.toLowerCase())

  const pages: [string, string, React.ReactNode][] = [
    ...channels.map((c): [string, string, React.ReactNode] => [
      c.label,
      c.path,
      <c.icon />,
    ]),
    ["All inboxes", "/inboxes", <LayersIcon />],
    ["Webhooks", "/webhooks", <WebhookIcon />],
    ["API log", "/requests", <ScrollTextIcon />],
    ["Adapters", "/adapters", <BlocksIcon />],
    ...adapters.map((a): [string, string, React.ReactNode] => [
      `${a.name} settings`,
      `/adapters/${a.id}`,
      <AdapterMark id={a.id} className="size-4 text-[9px]" />,
    ]),
    ["Agent access", "/agents", <BotIcon />],
    ["Settings", "/settings", <SettingsIcon />],
  ]
  const shownPages = pages.filter(([label]) => matches(label))

  return (
    <CommandDialog
      open={open}
      onOpenChange={close}
      title="Command menu"
      description="Jump to an inbox or run an action"
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={q}
          onValueChange={setQ}
          placeholder="Search inboxes by address, label or tag:…"
        />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          {top.length ? (
            <CommandGroup
              heading={
                query
                  ? `Inboxes · ${formatCount(results.total)} match`
                  : "Recently active inboxes"
              }
            >
              {top.map((i) => {
                const meta = getChannel(i.channel)
                return (
                  <CommandItem
                    key={i.id}
                    value={`inbox:${i.id}`}
                    onSelect={() => go(`${meta.path}/${i.id}`)}
                  >
                    <meta.icon />
                    <span className="truncate">
                      {i.label ?? meta.formatAddress(i.address)}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <span className="max-w-48 truncate font-mono text-[11px] text-muted-foreground">
                        {i.catchAll ? "*" : meta.formatAddress(i.address)}
                      </span>
                      {i.unreadCount ? <UnreadBadge n={i.unreadCount} /> : null}
                    </span>
                  </CommandItem>
                )
              })}
              {results.total > RESULTS ? (
                <CommandItem
                  value="inbox:more"
                  onSelect={() =>
                    go(
                      `/inboxes${query ? `?q=${encodeURIComponent(query)}` : ""}`
                    )
                  }
                >
                  <SearchIcon />
                  <span className="text-muted-foreground">
                    See all {formatCount(results.total)}{" "}
                    {query ? "matching inboxes" : "inboxes"}
                  </span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          ) : null}
          {shownPages.length ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Go to">
                {shownPages.map(([label, to, icon]) => (
                  <CommandItem
                    key={to}
                    value={`page:${to}`}
                    onSelect={() => go(to)}
                  >
                    {icon} {label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
          {matches("toggle dark mode") || matches("reset all data") ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Actions">
                {matches("toggle dark mode") ? (
                  <CommandItem
                    value="action:theme"
                    onSelect={() => {
                      setTheme(theme === "dark" ? "light" : "dark")
                      close(false)
                    }}
                  >
                    <MoonIcon /> Toggle dark mode{" "}
                    <CommandShortcut>D</CommandShortcut>
                  </CommandItem>
                ) : null}
                {matches("reset all data") ? (
                  <CommandItem
                    value="action:reset"
                    onSelect={() => {
                      void api.reset()
                      close(false)
                      toast("State reset to seed")
                    }}
                  >
                    <RotateCcwIcon /> Reset all data
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
