import { KeyRoundIcon, LinkIcon } from "lucide-react"
import { extract } from "@/lib/extract"
import { cn } from "@/lib/utils"
import { CopyButton } from "./bits"

/**
 * The bit of a message a test actually needs. Shown above the body so a human
 * can grab it fast, and mirrored by GET /api/messages/:id/extract for agents.
 */
export function Extracted({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const { codes, links } = extract(text)
  if (!codes.length && !links.length) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {codes.map((c) => (
        <span
          key={c}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background pr-0.5 pl-2 text-xs"
        >
          <KeyRoundIcon
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
          <span className="text-muted-foreground">Code</span>
          <span className="font-mono font-medium tracking-wider">{c}</span>
          <CopyButton value={c} label="Copy code" />
        </span>
      ))}
      {links.map((l) => (
        <span
          key={l}
          className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-background pr-0.5 pl-2 text-xs"
        >
          <LinkIcon
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <a
            href={l}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono text-[11px] underline-offset-2 hover:underline"
          >
            {l.replace(/^https?:\/\//, "")}
          </a>
          <CopyButton value={l} label="Copy link" />
        </span>
      ))}
    </div>
  )
}
