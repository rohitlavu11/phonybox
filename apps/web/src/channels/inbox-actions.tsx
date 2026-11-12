import { useNavigate } from "react-router"
import { toast } from "sonner"
import {
  BotIcon,
  CheckCheckIcon,
  CopyIcon,
  EllipsisIcon,
  EraserIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react"
import { api } from "@/api/client"
import type { InboxSummary } from "@/api/types"
import { getChannel } from "@/channels/meta"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ALL } from "./inbox-pane"

/** The "…" menu in every inbox header. Same actions on every channel. */
export function InboxActions({ inbox }: { inbox: InboxSummary }) {
  const navigate = useNavigate()
  const meta = getChannel(inbox.channel)
  const apiUrl = `http://127.0.0.1:4100/api/inboxes/${encodeURIComponent(inbox.address)}/messages`
  const sel = { ids: [inbox.id] }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${meta.inboxNoun} actions`}
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-mono text-[11px] font-normal text-muted-foreground">
          {inbox.catchAll ? "*@any-domain" : meta.formatAddress(inbox.address)}
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard?.writeText(inbox.address)
            toast("Address copied")
          }}
        >
          <CopyIcon /> Copy {meta.addressLabel.toLowerCase()}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard?.writeText(apiUrl)
            toast("Agent URL copied", { description: apiUrl })
          }}
        >
          <BotIcon /> Copy agent API URL
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void api.setPinned([inbox.id], !inbox.pinned)}
        >
          {inbox.pinned ? <PinOffIcon /> : <PinIcon />}{" "}
          {inbox.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!inbox.unreadCount}
          onSelect={() => void api.markInboxesRead(sel)}
        >
          <CheckCheckIcon /> Mark all as read
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!inbox.messageCount}
          onSelect={() => {
            void api.clearInboxes(sel)
            navigate(`${meta.path}/${inbox.id}`)
            toast(
              `Cleared ${inbox.messageCount} item${inbox.messageCount === 1 ? "" : "s"}`
            )
          }}
        >
          <EraserIcon /> Empty {meta.inboxNoun}
          <DropdownMenuShortcut className="font-mono">
            {inbox.messageCount}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {!inbox.catchAll ? (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              void api.deleteInboxes(sel)
              navigate(`${meta.path}/${ALL}`)
              toast(`Deleted ${meta.formatAddress(inbox.address)}`)
            }}
          >
            <Trash2Icon /> Delete {meta.inboxNoun}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
