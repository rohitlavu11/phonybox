import {
  MailIcon,
  MessageSquareTextIcon,
  PrinterIcon,
  type LucideIcon,
} from "lucide-react"
import type { ChannelId } from "@/types/domain"
import { formatPhone } from "@/lib/format"

/**
 * Everything the shell needs to know about a channel. A new channel (voice,
 * push, WhatsApp…) adds an entry here and a view in ./views.tsx.
 */
export interface ChannelMeta {
  id: ChannelId
  label: string
  /** What one inbox is called on this channel. */
  inboxNoun: string
  inboxNounPlural: string
  path: string
  icon: LucideIcon
  addressLabel: string
  addressPlaceholder: string
  formatAddress: (address: string) => string
}

export const channels: ChannelMeta[] = [
  {
    id: "email",
    label: "Mail",
    inboxNoun: "inbox",
    inboxNounPlural: "inboxes",
    path: "/mail",
    icon: MailIcon,
    addressLabel: "Address",
    addressPlaceholder: "agent-3@inbox.test",
    formatAddress: (a) => a,
  },
  {
    id: "sms",
    label: "SMS",
    inboxNoun: "number",
    inboxNounPlural: "numbers",
    path: "/sms",
    icon: MessageSquareTextIcon,
    addressLabel: "Phone number",
    addressPlaceholder: "+14155550190",
    formatAddress: formatPhone,
  },
  {
    id: "fax",
    label: "Fax",
    inboxNoun: "fax line",
    inboxNounPlural: "fax lines",
    path: "/fax",
    icon: PrinterIcon,
    addressLabel: "Fax number",
    addressPlaceholder: "+12125550120",
    formatAddress: formatPhone,
  },
]

export function getChannel(id: ChannelId): ChannelMeta {
  return channels.find((c) => c.id === id)!
}
