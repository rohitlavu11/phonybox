import { Link } from "react-router"
import { getAdapter } from "@/adapters"
import { useRequestFor, useWebhooksFor } from "@/api/hooks"
import type { ChannelItem } from "@/types/domain"
import { fullTime } from "@/lib/format"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  AdapterMark,
  CodeBlock,
  DirectionTag,
  HttpCode,
  KeyValue,
  StatusLabel,
  Time,
} from "./bits"

/** Side sheet with the provider-shaped record, the API call and the webhooks for one item. */
export function ItemInspector({
  item,
  onOpenChange,
}: {
  item: ChannelItem | null
  onOpenChange: (open: boolean) => void
}) {
  const hooks = useWebhooksFor(item?.id ?? "").data ?? []
  const request = useRequestFor(item?.id ?? "").data
  if (!item) return <Sheet open={false} onOpenChange={onOpenChange} />

  const adapter = getAdapter(item.adapterId)
  const record =
    item.channel === "sms"
      ? {
          record_type: "message",
          id: item.providerId,
          direction: item.direction,
          type: item.media.length ? "MMS" : "SMS",
          from:
            item.direction === "outbound" ? item.appNumber : item.peerNumber,
          to: item.direction === "outbound" ? item.peerNumber : item.appNumber,
          text: item.body,
          parts: item.parts,
          media: item.media,
          status: item.status,
          created_at: item.createdAt,
        }
      : item.channel === "fax"
        ? {
            record_type: "fax",
            id: item.providerId,
            direction: item.direction,
            from:
              item.direction === "outbound" ? item.appNumber : item.peerNumber,
            to:
              item.direction === "outbound" ? item.peerNumber : item.appNumber,
            page_count: item.pages,
            quality: item.quality,
            status: item.status,
            ...(item.failureReason
              ? { failure_reason: item.failureReason }
              : {}),
            created_at: item.createdAt,
          }
        : item

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-full gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <AdapterMark id={item.adapterId} />
            {adapter?.name} {item.channel === "fax" ? "fax" : "message"}
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px]">
            {"providerId" in item ? item.providerId : item.id}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="space-y-5 p-4">
            <KeyValue
              rows={[
                [
                  "Direction",
                  <DirectionTag
                    direction={item.direction}
                    adapterId={item.adapterId}
                  />,
                ],
                ["Status", <StatusLabel status={item.status} />],
                ["Created", fullTime(item.createdAt)],
              ]}
            />

            {request ? (
              <section className="space-y-1.5">
                <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  API call from your app
                </h3>
                <Link
                  to={`/requests?id=${request.id}`}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 text-xs hover:bg-accent"
                >
                  <HttpCode status={request.status} />
                  <span className="font-mono text-[11px] font-medium">
                    {request.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {request.path}
                  </span>
                  <Time
                    iso={request.createdAt}
                    className="text-muted-foreground"
                  />
                </Link>
              </section>
            ) : null}

            <section className="space-y-1.5">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Webhooks sent to your app
              </h3>
              {hooks.length ? (
                <ol className="divide-y overflow-hidden rounded-md border">
                  {hooks.map((w) => (
                    <li key={w.id}>
                      <Link
                        to={`/webhooks?id=${w.id}`}
                        className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-accent"
                      >
                        <HttpCode status={w.status} />
                        <code className="min-w-0 flex-1 truncate text-[11px]">
                          {w.event}
                        </code>
                        <span className="text-muted-foreground">
                          try {w.attempt}/{w.maxAttempts}
                        </span>
                        <Time
                          iso={w.createdAt}
                          className="w-8 text-right text-muted-foreground"
                        />
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">None.</p>
              )}
            </section>

            <section className="space-y-1.5">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Record
              </h3>
              <CodeBlock code={JSON.stringify(record, null, 2)} />
            </section>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
