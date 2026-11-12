import * as React from "react"
import { toast } from "sonner"
import { api } from "@/api/client"
import type { EmailMessage, Inbox } from "@/types/domain"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Kbd } from "@/components/ui/kbd"
import { InboundRoute, fromLabel } from "../send-to-app"

interface Props {
  inbox: Inbox
  open: boolean
  replyTo?: EmailMessage
  onOpenChange: (open: boolean) => void
  onSent: (m: EmailMessage) => void
}

export function ComposeEmail({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-xl">
        {/* Content unmounts on close, so each open starts from fresh state. */}
        <ComposeForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function initialDraft(replyTo?: EmailMessage) {
  if (!replyTo) return { to: "support@mg.acme.test", subject: "", text: "" }
  const other =
    replyTo.direction === "outbound"
      ? replyTo.from.address
      : replyTo.to[0]?.address
  return {
    to: other?.replace(/^noreply@/, "support@") ?? "support@mg.acme.test",
    subject: replyTo.subject.startsWith("Re:")
      ? replyTo.subject
      : `Re: ${replyTo.subject}`,
    text: `\n\nOn ${new Date(replyTo.createdAt).toLocaleString()} ${replyTo.from.address} wrote:\n> ${replyTo.text.split("\n")[0]}`,
  }
}

function ComposeForm({
  inbox,
  replyTo,
  onSent,
  onClose,
}: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [draft, setDraft] = React.useState(() => initialDraft(replyTo))
  const set = (patch: Partial<typeof draft>) =>
    setDraft((d) => ({ ...d, ...patch }))
  const ready = Boolean(draft.to.trim() && draft.subject.trim())

  function send() {
    if (!ready) return
    void api
      .sendEmailToApp({
        inbox,
        to: draft.to.trim(),
        subject: draft.subject.trim(),
        text: draft.text,
      })
      .then(onSent)
    onClose()
    toast.success("Delivered to your app", {
      description: `route.forward → 200 OK`,
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {replyTo ? "Reply to your app" : "Send mail to your app"}
        </DialogTitle>
        <DialogDescription>
          Sent as{" "}
          <span className="font-mono text-foreground">{fromLabel(inbox)}</span>.
          Your app receives it the way it would from Mailgun in production.
        </DialogDescription>
      </DialogHeader>

      <form
        id="compose-email"
        className="contents"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send()
        }}
      >
        <FieldGroup className="gap-3">
          <Field orientation="horizontal" className="gap-3">
            <FieldLabel
              htmlFor="ce-to"
              className="w-14 shrink-0 text-muted-foreground"
            >
              To
            </FieldLabel>
            <Input
              id="ce-to"
              className="font-mono text-xs"
              value={draft.to}
              onChange={(e) => set({ to: e.target.value })}
            />
          </Field>
          <Field orientation="horizontal" className="gap-3">
            <FieldLabel
              htmlFor="ce-subject"
              className="w-14 shrink-0 text-muted-foreground"
            >
              Subject
            </FieldLabel>
            <Input
              id="ce-subject"
              autoFocus={!replyTo}
              value={draft.subject}
              onChange={(e) => set({ subject: e.target.value })}
            />
          </Field>
          <Textarea
            aria-label="Message body"
            autoFocus={Boolean(replyTo)}
            value={draft.text}
            onChange={(e) => set({ text: e.target.value })}
            className="min-h-40 text-[13px] leading-relaxed"
            placeholder="Write the message your app should receive…"
          />
        </FieldGroup>
      </form>

      <DialogFooter className="flex-col items-stretch gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <InboundRoute inbox={inbox} event="route.forward" urlKey="routeUrl" />
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-0.5 text-[11px] text-muted-foreground sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </span>
          <Button type="submit" form="compose-email" disabled={!ready}>
            Send to app
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
