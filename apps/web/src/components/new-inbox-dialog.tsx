import * as React from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { adapters } from "@/adapters"
import { api } from "@/api/client"
import { useInbox } from "@/api/hooks"
import type { NewInbox } from "@/api/types"
import { channels, getChannel } from "@/channels/meta"
import { formatCount } from "@/channels/inbox-pane"
import type { ChannelId } from "@/types/domain"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

type Mode = "one" | "many"
const MAX_BULK = 1000

/** Fictional 555-01xx numbers: 100 per area code. */
function phoneBatch(area: string, count: number) {
  return Array.from(
    { length: Math.min(count, 100) },
    (_, i) => `+1${area}55501${String(i).padStart(2, "0")}`
  )
}

export function NewInboxDialog({
  channel: initialChannel,
  open,
  onOpenChange,
}: {
  channel: ChannelId
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [channel, setChannel] = React.useState<ChannelId>(initialChannel)
  const [mode, setMode] = React.useState<Mode>("one")
  const [address, setAddress] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [prefix, setPrefix] = React.useState("load")
  const [domain, setDomain] = React.useState("inbox.test")
  const [area, setArea] = React.useState("415")
  const [count, setCount] = React.useState(50)
  const [tags, setTags] = React.useState("")
  const [adapterId, setAdapterId] = React.useState(
    adapters.find((a) => a.channels.includes(initialChannel))?.id ?? ""
  )
  const meta = getChannel(channel)
  const options = adapters.filter((a) => a.channels.includes(channel))
  const email = channel === "email"

  const pickChannel = (c: ChannelId) => {
    setChannel(c)
    setAdapterId(adapters.find((a) => a.channels.includes(c))?.id ?? "")
  }

  const batch: NewInbox[] = React.useMemo(() => {
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    if (mode === "one") {
      const a = email
        ? address.trim().toLowerCase()
        : address.replace(/[^\d+]/g, "")
      return a
        ? [
            {
              channel,
              address: a,
              label: label.trim() || undefined,
              adapterId,
              tags: tagList,
            },
          ]
        : []
    }
    const n = Math.max(1, Math.min(MAX_BULK, count))
    const addresses = email
      ? Array.from(
          { length: n },
          (_, i) =>
            `${prefix.trim() || "inbox"}-${i + 1}@${domain.trim() || "inbox.test"}`
        )
      : phoneBatch(area.replace(/\D/g, "").slice(0, 3).padEnd(3, "0"), n)
    return addresses.map((a, i) => ({
      channel,
      address: a,
      label: label.trim() ? `${label.trim()} #${i + 1}` : undefined,
      adapterId,
      tags: tagList,
    }))
  }, [
    mode,
    email,
    address,
    label,
    channel,
    adapterId,
    tags,
    count,
    prefix,
    domain,
    area,
  ])

  const single = mode === "one" ? batch[0] : undefined
  const existing = useInbox(single?.address).data
  const taken = Boolean(existing && existing.channel === channel)
  const valid =
    mode === "many"
      ? batch.length > 0
      : Boolean(single) &&
        (email
          ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(single!.address)
          : /^\+\d{8,15}$/.test(single!.address))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || taken) return
    const made = await api.createInboxes(batch)
    onOpenChange(false)
    if (mode === "one" && made[0]) {
      toast.success(`${meta.formatAddress(made[0].address)} is ready`, {
        description: "Anything your app sends to it lands here.",
      })
      navigate(`${meta.path}/${made[0].id}`)
    } else {
      const skipped = batch.length - made.length
      toast.success(
        `Created ${formatCount(made.length)} ${meta.inboxNounPlural}`,
        {
          description: skipped
            ? `${skipped} already existed and were skipped.`
            : undefined,
        }
      )
      navigate(`/inboxes?channel=${channel}&sort=created`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>New {meta.inboxNoun}</DialogTitle>
            <DialogDescription>
              Give each agent or test run its own {meta.inboxNoun} so their
              messages never mix.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="gap-4">
            <div className="flex items-center justify-between gap-3">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={channel}
                onValueChange={(v) => v && pickChannel(v as ChannelId)}
              >
                {channels.map((c) => (
                  <ToggleGroupItem
                    key={c.id}
                    value={c.id}
                    className="gap-1.5 px-2.5"
                  >
                    <c.icon className="size-3.5" />
                    {c.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <TabsList>
                  <TabsTrigger value="one" className="px-2.5">
                    One
                  </TabsTrigger>
                  <TabsTrigger value="many" className="px-2.5">
                    Many
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {mode === "one" ? (
              <Field data-invalid={taken || undefined}>
                <FieldLabel htmlFor="inbox-address">
                  {meta.addressLabel}
                </FieldLabel>
                <Input
                  id="inbox-address"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  placeholder={meta.addressPlaceholder}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  aria-invalid={taken || undefined}
                />
                <FieldDescription>
                  {taken
                    ? `That ${meta.inboxNoun} already exists.`
                    : email
                      ? "Any domain works. Nothing leaves this machine."
                      : "E.164 format. 555-01xx numbers are reserved for fiction, so they're a safe pick."}
                </FieldDescription>
              </Field>
            ) : (
              <Field>
                <FieldLabel>{email ? "Addresses" : "Numbers"}</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="How many"
                    type="number"
                    min={1}
                    max={email ? MAX_BULK : 100}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value) || 1)}
                    className="w-20 shrink-0 text-right tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">×</span>
                  {email ? (
                    <>
                      <Input
                        aria-label="Prefix"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        className="font-mono text-xs"
                      />
                      <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        -n@
                      </span>
                      <Input
                        aria-label="Domain"
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        className="font-mono text-xs"
                      />
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-muted-foreground">
                        +1
                      </span>
                      <Input
                        aria-label="Area code"
                        value={area}
                        onChange={(e) => setArea(e.target.value)}
                        className="w-16 font-mono text-xs"
                      />
                      <span className="font-mono text-xs text-muted-foreground">
                        555-01xx
                      </span>
                    </>
                  )}
                </div>
                <FieldDescription className="font-mono text-[11px]">
                  {batch.length
                    ? `${meta.formatAddress(batch[0].address)}${batch.length > 1 ? ` … ${meta.formatAddress(batch[batch.length - 1].address)}` : ""}`
                    : "—"}
                  {!email ? (
                    <span className="font-sans">
                      {" "}
                      · up to 100 per area code
                    </span>
                  ) : null}
                </FieldDescription>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="inbox-label">
                  Label{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FieldLabel>
                <Input
                  id="inbox-label"
                  placeholder={mode === "many" ? "Load test" : "Checkout agent"}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="inbox-tags">
                  Tags{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FieldLabel>
                <Input
                  id="inbox-tags"
                  placeholder="suite:checkout, run:7"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="font-mono text-xs"
                />
              </Field>
            </div>

            <Field>
              <FieldLabel>Sends to your app through</FieldLabel>
              <Select value={adapterId} onValueChange={setAdapterId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <DialogFooter className="items-center sm:justify-between">
            <code className="hidden text-[11px] text-muted-foreground sm:block">
              POST /api/inboxes
            </code>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || taken}>
                {mode === "many"
                  ? `Create ${formatCount(batch.length)}`
                  : `Create ${meta.inboxNoun}`}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
