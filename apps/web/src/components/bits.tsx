/**
 * Small building blocks used across every channel. Kept in one file because
 * each is a few lines and they're always read together.
 */
import * as React from "react"
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getAdapter } from "@/adapters"
import type { DeliveryStatus, Direction } from "@/types/domain"
import { fullTime, relativeTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/* ------------------------------------------------------------ AdapterMark */

export function AdapterMark({
  id,
  className,
}: {
  id: string
  className?: string
}) {
  const a = getAdapter(id)
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] border bg-background font-mono text-[10px] font-medium tracking-tight text-foreground/80",
        className
      )}
    >
      {a?.monogram ?? id.slice(0, 2)}
    </span>
  )
}

/* ------------------------------------------------------------- CopyButton */

export function CopyButton({
  value,
  label = "Copy",
  className,
  size = "icon-xs",
}: {
  value: string
  label?: string
  className?: string
  size?: "icon-xs" | "icon-sm"
}) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          aria-label={label}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            className
          )}
          onClick={(e) => {
            e.stopPropagation()
            void navigator.clipboard?.writeText(value)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? <CheckIcon className="text-ok" /> : <CopyIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  )
}

/* -------------------------------------------------------------- CodeBlock */

/** Light-touch JSON tinting: keys and strings only. Anything fancier is noise. */
function tint(code: string) {
  if (!/^\s*[{[]/.test(code)) return code
  const parts: React.ReactNode[] = []
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(code))) {
    if (m.index > last) parts.push(code.slice(last, m.index))
    if (m[1] && m[2]) {
      parts.push(
        <span key={k++} className="text-foreground">
          {m[1]}
        </span>,
        m[2]
      )
    } else if (m[1]) {
      parts.push(
        <span key={k++} className="text-[color:var(--ok)]">
          {m[1]}
        </span>
      )
    } else {
      parts.push(
        <span key={k++} className="text-signal">
          {m[0]}
        </span>
      )
    }
    last = m.index + m[0].length
  }
  parts.push(code.slice(last))
  return parts
}

/**
 * Compact single-line JSON (Telnyx signs the exact compact bytes) is shown
 * indented for reading. Copy buttons always copy the original text.
 */
function readable(code: string) {
  if (code.includes("\n") || !/^\s*[{[]/.test(code)) return code
  try {
    return JSON.stringify(JSON.parse(code), null, 2)
  } catch {
    return code
  }
}

export function CodeBlock({
  code,
  title,
  className,
  wrap = false,
}: {
  code: string
  title?: React.ReactNode
  className?: string
  wrap?: boolean
}) {
  return (
    <div
      className={cn(
        "group/code relative overflow-hidden rounded-md border bg-muted/40",
        className
      )}
    >
      {title ? (
        <div className="flex h-8 items-center justify-between border-b bg-muted/50 pr-1 pl-3 text-[11px] text-muted-foreground">
          <span className="truncate font-mono">{title}</span>
          <CopyButton value={code} />
        </div>
      ) : (
        <CopyButton
          value={code}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100"
        />
      )}
      <pre
        className={cn(
          "overflow-x-auto p-3 font-mono text-[12px] leading-[1.6] text-muted-foreground",
          wrap && "break-all whitespace-pre-wrap"
        )}
      >
        <code>{tint(readable(code))}</code>
      </pre>
    </div>
  )
}

/* ---------------------------------------------------------- DirectionTag */

const directionCopy: Record<
  Direction,
  { label: string; hint: (adapter: string) => string }
> = {
  outbound: {
    label: "Outbound",
    hint: (a) =>
      `Your app sent this through the ${a} API. It was captured here instead of being delivered.`,
  },
  inbound: {
    label: "Inbound",
    hint: (a) =>
      `Sent from this inbox to your app, delivered as a ${a} webhook.`,
  },
}

export function DirectionTag({
  direction,
  adapterId,
  compact = false,
  className,
}: {
  direction: Direction
  adapterId: string
  compact?: boolean
  className?: string
}) {
  const Icon = direction === "outbound" ? ArrowUpRightIcon : ArrowDownLeftIcon
  const adapterName = getAdapter(adapterId)?.name ?? adapterId
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground",
            className
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {compact ? (
            <span className="sr-only">{directionCopy[direction].label}</span>
          ) : (
            directionCopy[direction].label
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {directionCopy[direction].hint(adapterName)}
      </TooltipContent>
    </Tooltip>
  )
}

/* ---------------------------------------------------------- StatusLabel */

const statusTone: Record<DeliveryStatus, string> = {
  delivered: "bg-ok",
  received: "bg-ok",
  queued: "bg-warn",
  sending: "bg-warn",
  failed: "bg-destructive",
  bounced: "bg-destructive",
}

export function StatusLabel({
  status,
  className,
}: {
  status: DeliveryStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] text-muted-foreground capitalize",
        className
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", statusTone[status])}
      />
      {status}
    </span>
  )
}

/* ------------------------------------------------------------- HttpCode */

export function HttpCode({
  status,
  className,
}: {
  status: number | null
  className?: string
}) {
  const tone =
    status === null || status >= 500
      ? "text-destructive border-destructive/30 bg-destructive/5"
      : status >= 400
        ? "text-[color:var(--warn)] border-[color:var(--warn)]/40 bg-[color:var(--warn)]/5"
        : "text-[color:var(--ok)] border-[color:var(--ok)]/30 bg-[color:var(--ok)]/5"
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-9 items-center justify-center rounded-[4px] border px-1 font-mono text-[11px] font-medium tabular-nums",
        tone,
        className
      )}
    >
      {status ?? "ERR"}
    </span>
  )
}

/* ------------------------------------------------------------ MethodTag */

export function MethodTag({ method }: { method: string }) {
  return (
    <span className="inline-block w-11 font-mono text-[11px] font-medium text-muted-foreground">
      {method}
    </span>
  )
}

/* ----------------------------------------------------------------- Time */

export function Time({ iso, className }: { iso: string; className?: string }) {
  return (
    <time
      dateTime={iso}
      title={fullTime(iso)}
      className={cn("tabular-nums", className)}
    >
      {relativeTime(iso)}
    </time>
  )
}

/* -------------------------------------------------------------- UnreadDot */

export function UnreadDot({
  show,
  className,
}: {
  show: boolean
  className?: string
}) {
  return (
    <span
      aria-label={show ? "Unread" : undefined}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        show ? "bg-signal" : "bg-transparent",
        className
      )}
    />
  )
}

/* --------------------------------------------------------------- KeyValue */

export function KeyValue({
  rows,
  className,
}: {
  rows: [React.ReactNode, React.ReactNode][]
  className?: string
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1.5 text-xs",
        className
      )}
    >
      {rows.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}
