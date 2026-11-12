import * as React from "react"
import { Link } from "react-router"
import { CheckIcon, ChevronsUpDownIcon, InboxIcon } from "lucide-react"
import { useChannelStats, useInboxes } from "@/api/hooks"
import type { InboxSummary } from "@/api/types"
import type { ChannelId } from "@/types/domain"
import { getChannel } from "@/channels/meta"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ALL, UnreadBadge, formatCount } from "./inbox-pane"

/**
 * Compact inbox picker used when there's no room for the inbox column.
 * Server-side search; shows the first page of matches.
 */
export function InboxSwitcher({
  channel,
  inbox,
  onSelect,
}: {
  channel: ChannelId
  inbox: InboxSummary | null
  onSelect: (id: string) => void
}) {
  const meta = getChannel(channel)
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const query = React.useDeferredValue(q)
  const list = useInboxes({ channel, q: query })
  const total =
    useChannelStats().data?.find((s) => s.channel === channel)?.inboxes ?? 0
  const shown = list.items.slice(0, 50)

  const choose = (id: string) => {
    setOpen(false)
    setQ("")
    onSelect(id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-1.5 h-7 gap-1.5 px-1.5 text-[13px] font-medium"
          aria-label={`Switch ${meta.inboxNoun}`}
        >
          <span className="max-w-[16rem] truncate">
            {inbox
              ? (inbox.label ?? meta.formatAddress(inbox.address))
              : `All ${meta.inboxNounPlural}`}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={`Search ${formatCount(total)} ${meta.inboxNounPlural}…`}
          />
          <CommandList className="max-h-80">
            <CommandEmpty>No matches.</CommandEmpty>
            {!query ? (
              <CommandGroup>
                <CommandItem value={ALL} onSelect={() => choose(ALL)}>
                  <InboxIcon /> All {meta.inboxNounPlural}
                  {!inbox ? <CheckIcon className="ml-auto" /> : null}
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup
              heading={
                query ? `${formatCount(list.total)} matches` : "Recently active"
              }
            >
              {shown.map((i) => (
                <CommandItem
                  key={i.id}
                  value={i.id}
                  onSelect={() => choose(i.id)}
                  className="items-start"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {i.label ?? meta.formatAddress(i.address)}
                    </span>
                    <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                      {i.catchAll
                        ? "any other address"
                        : meta.formatAddress(i.address)}
                    </span>
                  </span>
                  {i.unreadCount ? <UnreadBadge n={i.unreadCount} /> : null}
                  {inbox?.id === i.id ? <CheckIcon /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {list.total > shown.length ? (
            <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
              <span>
                {shown.length} of {formatCount(list.total)}. Keep typing to
                narrow.
              </span>
              <Link
                to={`/inboxes?channel=${channel}`}
                onClick={() => setOpen(false)}
                className="text-foreground hover:underline"
              >
                Browse all
              </Link>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
