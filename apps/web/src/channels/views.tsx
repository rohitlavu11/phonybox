import type * as React from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router"
import { useInbox } from "@/api/hooks"
import type { InboxSummary } from "@/api/types"
import type { ChannelId } from "@/types/domain"
import { useIsMobile } from "@/hooks/use-mobile"
import { PageHeader } from "@/components/layout/page-header"
import { getChannel } from "./meta"
import { ALL, InboxPane } from "./inbox-pane"
import { MailView } from "./email/mail-view"
import { SmsView } from "./sms/sms-view"
import { FaxView } from "./fax/fax-view"

/** Channel id -> screen. The only place a new channel's view gets registered. */
const views: Record<
  ChannelId,
  React.ComponentType<{ inbox: InboxSummary | null }>
> = {
  email: MailView,
  sms: SmsView,
  fax: FaxView,
}

export function ChannelRoute({ channel }: { channel: ChannelId }) {
  const { inboxId } = useParams()
  const mobile = useIsMobile()
  const navigate = useNavigate()
  const meta = getChannel(channel)
  const isAll = inboxId === ALL
  const { data: inbox, isLoading } = useInbox(isAll ? undefined : inboxId)

  if (!inboxId) {
    // Phones get the inbox list as its own screen; wider screens land on "all".
    if (!mobile) return <Navigate to={`${meta.path}/${ALL}`} replace />
    return (
      <>
        <PageHeader title={meta.label} />
        <InboxPane
          channel={channel}
          selectedId=""
          onSelect={(id) => navigate(`${meta.path}/${id}`)}
          className="flex-1"
        />
      </>
    )
  }

  if (!isAll && !inbox) {
    if (isLoading) return null
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <meta.icon className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium">
          No {meta.inboxNoun} called “{inboxId}”
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          It may have been deleted by a cleanup rule or another agent.{" "}
          <Link
            to={`${meta.path}/${ALL}`}
            className="text-foreground underline underline-offset-2"
          >
            Back to all {meta.inboxNounPlural}
          </Link>
        </p>
      </div>
    )
  }

  const View = views[channel]
  return <View key={inboxId} inbox={isAll ? null : inbox!} />
}
