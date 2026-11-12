import * as React from "react"
import { useNavigate } from "react-router"
import type { InboxSummary } from "@/api/types"
import type { ChannelId } from "@/types/domain"
import { useChannelStats } from "@/api/hooks"
import { useIsMobile, useIsWide } from "@/hooks/use-mobile"
import { getChannel } from "@/channels/meta"
import { CopyButton } from "@/components/bits"
import { PageHeader } from "@/components/layout/page-header"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ALL, InboxPane, formatCount } from "./inbox-pane"
import { InboxSwitcher } from "./inbox-switcher"

/**
 * Layout shared by every channel:
 *   >= 1400px  inbox column | list | detail
 *   >= 768px   list | detail, inbox switcher in the header
 *   <  768px   one pane at a time (routes drive which)
 */
export function ChannelShell({
  channel,
  inbox,
  actions,
  list,
  detail,
  hasDetail,
  listSize = "40%",
}: {
  channel: ChannelId
  /** null = all inboxes on this channel. */
  inbox: InboxSummary | null
  actions?: React.ReactNode
  list: React.ReactNode
  detail: React.ReactNode
  hasDetail: boolean
  listSize?: string
}) {
  const meta = getChannel(channel)
  const wide = useIsWide()
  const mobile = useIsMobile()
  const navigate = useNavigate()
  const total =
    useChannelStats().data?.find((s) => s.channel === channel)?.inboxes ?? 0
  const select = (id: string) => navigate(`${meta.path}/${id}`)

  const title = wide ? (
    inbox ? (
      (inbox.label ?? meta.formatAddress(inbox.address))
    ) : (
      `All ${meta.inboxNounPlural}`
    )
  ) : (
    <InboxSwitcher channel={channel} inbox={inbox} onSelect={select} />
  )

  const subtitle = inbox ? (
    inbox.catchAll ? (
      "mail to any address without its own inbox"
    ) : (
      <span className="inline-flex items-center gap-1 font-mono">
        {meta.formatAddress(inbox.address)}
        <CopyButton
          value={inbox.address}
          label={`Copy ${meta.addressLabel.toLowerCase()}`}
        />
      </span>
    )
  ) : (
    <span className="tabular-nums">
      {formatCount(total)} {meta.inboxNounPlural}
    </span>
  )

  return (
    <>
      <PageHeader title={title} meta={subtitle}>
        {actions}
      </PageHeader>
      {mobile ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {hasDetail ? detail : list}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {wide ? (
            <aside className="w-72 shrink-0 border-r">
              <InboxPane
                channel={channel}
                selectedId={inbox?.id ?? ALL}
                onSelect={select}
              />
            </aside>
          ) : null}
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 min-w-0 flex-1"
          >
            <ResizablePanel defaultSize={listSize} minSize={260} maxSize="60%">
              {list}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel minSize={340}>{detail}</ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </>
  )
}
