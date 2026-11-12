import { minutesAgo } from "@/lib/format"
import type {
  ApiRequest,
  ChannelItem,
  EmailMessage,
  FaxDocument,
  Inbox,
  SmsMessage,
  WebhookDelivery,
} from "@/types/domain"
import { buildWebhook, hex, uuid } from "./payloads"

/* ---------------------------------------------------------------- inboxes */

export const seedInboxes: Inbox[] = [
  {
    id: "agent-1",
    channel: "email",
    address: "agent-1@inbox.test",
    label: "Signup agent",
    adapterId: "mailgun",
    tags: ["suite:manual"],
    createdBy: "seed",
    pinned: true,
    createdAt: minutesAgo(300),
  },
  {
    id: "agent-2",
    channel: "email",
    address: "agent-2@inbox.test",
    label: "Billing agent",
    adapterId: "mailgun",
    tags: ["suite:manual"],
    createdBy: "seed",
    pinned: true,
    createdAt: minutesAgo(300),
  },
  {
    id: "qa",
    channel: "email",
    address: "qa@inbox.test",
    label: "Manual QA",
    adapterId: "mailgun",
    tags: ["suite:manual"],
    createdBy: "seed",
    createdAt: minutesAgo(900),
  },
  {
    id: "catch-all",
    channel: "email",
    address: "*",
    label: "Catch-all",
    adapterId: "mailgun",
    catchAll: true,
    tags: ["suite:manual"],
    createdBy: "seed",
    createdAt: minutesAgo(900),
  },
  {
    id: "phone-1",
    channel: "sms",
    address: "+14155550142",
    label: "Agent 1",
    adapterId: "telnyx",
    tags: ["suite:manual"],
    createdBy: "seed",
    pinned: true,
    createdAt: minutesAgo(300),
  },
  {
    id: "phone-2",
    channel: "sms",
    address: "+14155550177",
    label: "Agent 2",
    adapterId: "telnyx",
    tags: ["suite:manual"],
    createdBy: "seed",
    createdAt: minutesAgo(300),
  },
  {
    id: "fax-records",
    channel: "fax",
    address: "+12125550199",
    label: "Records desk",
    adapterId: "telnyx",
    tags: ["suite:manual"],
    createdBy: "seed",
    pinned: true,
    createdAt: minutesAgo(900),
  },
  {
    id: "fax-lab",
    channel: "fax",
    address: "+13125550164",
    label: "Lab intake",
    adapterId: "telnyx",
    tags: ["suite:manual"],
    createdBy: "seed",
    createdAt: minutesAgo(900),
  },
]

/* ------------------------------------------------------------------ email */

const ACME = { name: "Acme", address: "noreply@mg.acme.test" }

export function emailHtml(opts: {
  heading: string
  paras: string[]
  code?: string
  cta?: { label: string; href: string }
}) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1b19">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e6e4df;border-radius:6px">
<tr><td style="padding:28px 32px 8px"><div style="font-weight:700;font-size:15px;letter-spacing:-0.01em">acme</div></td></tr>
<tr><td style="padding:8px 32px 4px"><h1 style="margin:0;font-size:20px;line-height:1.3">${opts.heading}</h1></td></tr>
<tr><td style="padding:4px 32px 8px;font-size:14px;line-height:1.6">${opts.paras.map((p) => `<p style="margin:12px 0">${p}</p>`).join("")}</td></tr>
${opts.code ? `<tr><td style="padding:4px 32px 12px"><div style="font-family:ui-monospace,Menlo,monospace;font-size:28px;letter-spacing:0.18em;background:#f4f4f2;border-radius:4px;padding:14px 0;text-align:center">${opts.code}</div></td></tr>` : ""}
${opts.cta ? `<tr><td style="padding:8px 32px 20px"><a href="${opts.cta.href}" style="display:inline-block;background:#1c1b19;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:4px">${opts.cta.label}</a></td></tr>` : ""}
<tr><td style="padding:16px 32px 24px;border-top:1px solid #efeeea;font-size:12px;color:#77736b">Acme Inc. · 500 Howard St, San Francisco, CA<br/>You are receiving this because you have an Acme account.</td></tr>
</table></td></tr></table></body></html>`
}

export function headersFor(
  m: Omit<EmailMessage, "headers">
): [string, string][] {
  return [
    [
      "Received",
      `from api (127.0.0.1) by phonybox mailgun-adapter; ${new Date(m.createdAt).toUTCString()}`,
    ],
    ["Message-Id", m.messageId],
    ["Date", new Date(m.createdAt).toUTCString()],
    [
      "From",
      m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address,
    ],
    [
      "To",
      m.to
        .map((t) => (t.name ? `${t.name} <${t.address}>` : t.address))
        .join(", "),
    ],
    ["Subject", m.subject],
    ["Mime-Version", "1.0"],
    [
      "Content-Type",
      m.html
        ? 'multipart/alternative; boundary="lc-' + hex(m.id, 12) + '"'
        : "text/plain; charset=utf-8",
    ],
    ...(m.direction === "outbound"
      ? ([
          ["X-Mailgun-Sending-Ip", "127.0.0.1"],
          ["X-Mailgun-Tag", m.tags.join(", ") || "(none)"],
          ["X-Phonybox-Adapter", "mailgun@0.1.0"],
        ] as [string, string][])
      : ([["X-Phonybox-Origin", "inbox composer"]] as [string, string][])),
  ]
}

function mail(
  m: Omit<
    EmailMessage,
    "channel" | "headers" | "messageId" | "attachments" | "tags" | "adapterId"
  > &
    Partial<Pick<EmailMessage, "attachments" | "tags">>
): EmailMessage {
  const base = {
    channel: "email" as const,
    adapterId: "mailgun",
    attachments: [],
    tags: [],
    messageId: `<${new Date(m.createdAt).toISOString().replace(/\D/g, "").slice(0, 14)}.${hex(m.id, 16)}@mg.acme.test>`,
    ...m,
  }
  return { ...base, headers: headersFor(base) }
}

export const seedEmails: EmailMessage[] = [
  mail({
    id: "em-welcome",
    inboxId: "agent-1",
    direction: "outbound",
    from: ACME,
    to: [{ name: "Riley Chen", address: "agent-1@inbox.test" }],
    subject: "Welcome to Acme, Riley",
    text: "Your email is confirmed and your workspace is ready.\n\nNext step: invite the people you work with.\nhttp://localhost:3000/settings/members\n\n— The Acme team",
    html: emailHtml({
      heading: "Welcome to Acme, Riley",
      paras: [
        "Your email is confirmed and your workspace is ready.",
        "Next step: invite the people you work with. It takes a minute and you can change roles later.",
      ],
      cta: {
        label: "Invite your team",
        href: "http://localhost:3000/settings/members",
      },
    }),
    tags: ["onboarding"],
    status: "delivered",
    read: false,
    createdAt: minutesAgo(1),
  }),
  mail({
    id: "em-verify",
    inboxId: "agent-1",
    direction: "outbound",
    from: ACME,
    to: [{ address: "agent-1@inbox.test" }],
    subject: "Confirm your email address",
    text: "Enter this verification code to finish signing up:\n\n482 913\n\nOr open this link: http://localhost:3000/verify?token=evt_9f2c1b7e04d8a6\n\nThe code expires in 15 minutes. If you didn't sign up for Acme, ignore this email.",
    html: emailHtml({
      heading: "Confirm your email address",
      paras: ["Enter this verification code to finish signing up:"],
      code: "482 913",
      cta: {
        label: "Confirm email",
        href: "http://localhost:3000/verify?token=evt_9f2c1b7e04d8a6",
      },
    }),
    tags: ["verify-email"],
    status: "delivered",
    read: true,
    createdAt: minutesAgo(6),
  }),
  mail({
    id: "em-payfail",
    inboxId: "agent-2",
    direction: "outbound",
    from: { name: "Acme Billing", address: "billing@mg.acme.test" },
    to: [{ address: "agent-2@inbox.test" }],
    subject: "Payment failed for card ending 4242",
    text: "We couldn't charge your Visa ending 4242 for invoice INV-2041 ($249.00).\n\nUpdate your payment method: http://localhost:3000/billing/payment-method\n\nWe'll retry automatically in 3 days.",
    html: emailHtml({
      heading: "Payment failed",
      paras: [
        "We couldn't charge your Visa ending 4242 for invoice <b>INV-2041</b> ($249.00).",
        "We'll retry automatically in 3 days.",
      ],
      cta: {
        label: "Update payment method",
        href: "http://localhost:3000/billing/payment-method",
      },
    }),
    tags: ["billing", "dunning"],
    status: "bounced",
    read: false,
    createdAt: minutesAgo(9),
  }),
  mail({
    id: "em-question",
    inboxId: "agent-2",
    direction: "inbound",
    from: { name: "Billing Agent", address: "agent-2@inbox.test" },
    to: [{ address: "billing@mg.acme.test" }],
    subject: "Question about INV-2041",
    text: "Hi,\n\nInvoice INV-2041 lists 12 seats but we only have 9 active members. Can you check?\n\nThanks",
    status: "delivered",
    read: true,
    createdAt: minutesAgo(12),
  }),
  mail({
    id: "em-invoice",
    inboxId: "agent-2",
    direction: "outbound",
    from: { name: "Acme Billing", address: "billing@mg.acme.test" },
    to: [{ address: "agent-2@inbox.test" }],
    subject: "Your invoice INV-2041 is ready",
    text: "Invoice INV-2041 for $249.00 is attached.\n\nBilling period: Oct 11 – Nov 10, 2026\nSeats: 12\n\nView online: http://localhost:3000/billing/invoices/INV-2041",
    html: emailHtml({
      heading: "Invoice INV-2041",
      paras: [
        "Your invoice for <b>$249.00</b> is attached.",
        "Billing period: Oct 11 – Nov 10, 2026<br/>Seats: 12",
      ],
      cta: {
        label: "View invoice",
        href: "http://localhost:3000/billing/invoices/INV-2041",
      },
    }),
    attachments: [
      { filename: "INV-2041.pdf", contentType: "application/pdf", size: 48213 },
    ],
    tags: ["billing", "invoice"],
    status: "delivered",
    read: true,
    createdAt: minutesAgo(18),
  }),
  mail({
    id: "em-invite",
    inboxId: "catch-all",
    direction: "outbound",
    from: ACME,
    to: [{ address: "sam@contractor.dev" }],
    subject: "Riley Chen invited you to the Northwind workspace",
    text: "Riley Chen (agent-1@inbox.test) invited you to join Northwind on Acme.\n\nAccept the invite: http://localhost:3000/invite/inv_3Kd82LmQ\n\nThis invite expires in 7 days.",
    html: emailHtml({
      heading: "Join Northwind on Acme",
      paras: [
        "Riley Chen (agent-1@inbox.test) invited you to join <b>Northwind</b>.",
        "This invite expires in 7 days.",
      ],
      cta: {
        label: "Accept invite",
        href: "http://localhost:3000/invite/inv_3Kd82LmQ",
      },
    }),
    tags: ["invite"],
    status: "delivered",
    read: false,
    createdAt: minutesAgo(25),
  }),
  mail({
    id: "em-reply-reset",
    inboxId: "qa",
    direction: "inbound",
    from: { name: "QA", address: "qa@inbox.test" },
    to: [{ address: "support@mg.acme.test" }],
    subject: "Re: Reset your password",
    text: "The reset link says it expired, but I clicked it about two minutes after it arrived.\n\nOn Wed, Nov 11 at 9:55 AM Acme <noreply@mg.acme.test> wrote:\n> Reset your password",
    status: "delivered",
    read: true,
    createdAt: minutesAgo(41),
  }),
  mail({
    id: "em-reset",
    inboxId: "qa",
    direction: "outbound",
    from: ACME,
    to: [{ address: "qa@inbox.test" }],
    subject: "Reset your password",
    text: "Someone asked to reset the password for qa@inbox.test.\n\nReset it here: http://localhost:3000/reset?token=rst_51aa0c9e\n\nThe link works for 30 minutes. If this wasn't you, you can ignore this email.",
    html: emailHtml({
      heading: "Reset your password",
      paras: [
        "Someone asked to reset the password for qa@inbox.test.",
        "The link works for 30 minutes. If this wasn't you, you can ignore this email.",
      ],
      cta: {
        label: "Choose a new password",
        href: "http://localhost:3000/reset?token=rst_51aa0c9e",
      },
    }),
    tags: ["auth"],
    status: "delivered",
    read: true,
    createdAt: minutesAgo(47),
  }),
  mail({
    id: "em-signin",
    inboxId: "qa",
    direction: "outbound",
    from: ACME,
    to: [{ address: "qa@inbox.test" }],
    subject: "New sign-in to your Acme account",
    text: "We noticed a new sign-in.\n\nChrome on macOS · San Francisco, CA · 127.0.0.1\nWed, Nov 11, 8:31 AM PST\n\nIf this was you, there's nothing to do.",
    html: emailHtml({
      heading: "New sign-in",
      paras: [
        "Chrome on macOS · San Francisco, CA · 127.0.0.1<br/>Wed, Nov 11, 8:31 AM PST",
        "If this was you, there's nothing to do.",
      ],
    }),
    tags: ["security"],
    status: "delivered",
    read: true,
    createdAt: minutesAgo(131),
  }),
  mail({
    id: "em-digest",
    inboxId: "catch-all",
    direction: "outbound",
    from: ACME,
    to: [{ name: "Jane Doe", address: "jane.doe@example.com" }],
    subject: "Your week in Northwind: 14 tasks closed",
    text: "Here's what happened in Northwind this week.\n\n14 tasks closed · 3 new members · 2 projects shipped\n\nOpen your dashboard: http://localhost:3000/w/northwind",
    html: emailHtml({
      heading: "Your week in Northwind",
      paras: ["14 tasks closed · 3 new members · 2 projects shipped"],
      cta: {
        label: "Open dashboard",
        href: "http://localhost:3000/w/northwind",
      },
    }),
    tags: ["digest"],
    status: "delivered",
    read: true,
    createdAt: minutesAgo(190),
  }),
]

/* -------------------------------------------------------------------- sms */

function sms(
  m: Omit<
    SmsMessage,
    "channel" | "adapterId" | "providerId" | "media" | "parts"
  > &
    Partial<Pick<SmsMessage, "media">>
): SmsMessage {
  return {
    channel: "sms",
    adapterId: "telnyx",
    providerId: uuid(m.id),
    media: [],
    parts: Math.max(1, Math.ceil(m.body.length / 153)),
    ...m,
  }
}

export const seedSms: SmsMessage[] = [
  sms({
    id: "sm-1",
    inboxId: "phone-1",
    direction: "outbound",
    appNumber: "+16285550100",
    peerNumber: "+14155550142",
    body: "Acme: your verification code is 731604. It expires in 10 minutes. Don't share it with anyone.",
    status: "delivered",
    read: true,
    createdAt: minutesAgo(34),
  }),
  sms({
    id: "sm-2",
    inboxId: "phone-1",
    direction: "outbound",
    appNumber: "+16285550100",
    peerNumber: "+14155550142",
    body: "Acme: your onboarding call is Thu Nov 13 at 2:30 PM PT. Reply C to confirm or R to reschedule.",
    status: "delivered",
    read: true,
    createdAt: minutesAgo(22),
  }),
  sms({
    id: "sm-3",
    inboxId: "phone-1",
    direction: "inbound",
    appNumber: "+16285550100",
    peerNumber: "+14155550142",
    body: "C",
    status: "received",
    read: true,
    createdAt: minutesAgo(21),
  }),
  sms({
    id: "sm-4",
    inboxId: "phone-1",
    direction: "outbound",
    appNumber: "+16285550100",
    peerNumber: "+14155550142",
    body: "Thanks, you're confirmed. We'll text you 30 minutes before the call.",
    status: "delivered",
    read: true,
    createdAt: minutesAgo(21),
  }),
  sms({
    id: "sm-5",
    inboxId: "phone-1",
    direction: "outbound",
    appNumber: "+16285550111",
    peerNumber: "+14155550142",
    body: "Acme: order #10482 has shipped. Track it at http://localhost:3000/t/10482",
    status: "delivered",
    read: true,
    createdAt: minutesAgo(15),
  }),
  sms({
    id: "sm-6",
    inboxId: "phone-1",
    direction: "inbound",
    appNumber: "+16285550111",
    peerNumber: "+14155550142",
    body: "STOP",
    status: "received",
    read: true,
    createdAt: minutesAgo(4),
  }),
  sms({
    id: "sm-7",
    inboxId: "phone-1",
    direction: "outbound",
    appNumber: "+16285550111",
    peerNumber: "+14155550142",
    body: "You have been unsubscribed and will not receive more messages from this number. Reply START to resubscribe.",
    status: "delivered",
    read: false,
    createdAt: minutesAgo(4),
    note: "Automatic opt-out reply. Further sends from this number to this inbox return error 40300 until it texts START.",
  }),
  sms({
    id: "sm-8",
    inboxId: "phone-2",
    direction: "outbound",
    appNumber: "+16285550100",
    peerNumber: "+14155550177",
    body: "Acme support: sorry your order arrived damaged. Reply with a photo and we'll ship a replacement today.",
    status: "delivered",
    read: true,
    createdAt: minutesAgo(9),
  }),
  sms({
    id: "sm-9",
    inboxId: "phone-2",
    direction: "inbound",
    appNumber: "+16285550100",
    peerNumber: "+14155550177",
    body: "here you go, the corner is crushed",
    media: [
      { filename: "IMG_0412.jpg", contentType: "image/jpeg", size: 1248813 },
    ],
    status: "received",
    read: true,
    createdAt: minutesAgo(7),
  }),
]

/* -------------------------------------------------------------------- fax */

function fax(
  f: Omit<
    FaxDocument,
    "channel" | "adapterId" | "providerId" | "quality" | "read"
  > &
    Partial<Pick<FaxDocument, "quality" | "read">>
): FaxDocument {
  return {
    channel: "fax",
    adapterId: "telnyx",
    providerId: uuid(f.id),
    quality: "high",
    read: true,
    ...f,
  }
}

export const seedFaxes: FaxDocument[] = [
  fax({
    id: "fx-priorauth",
    inboxId: "fax-records",
    direction: "outbound",
    appNumber: "+16285550150",
    peerNumber: "+12125550199",
    title: "Prior authorization request",
    pages: 2,
    status: "failed",
    failureReason: "user_busy",
    read: false,
    events: [
      { event: "fax.queued", at: minutesAgo(8) },
      { event: "fax.media.processed", at: minutesAgo(8) },
      { event: "fax.sending.started", at: minutesAgo(8) },
      { event: "fax.failed", at: minutesAgo(7) },
    ],
    createdAt: minutesAgo(8),
  }),
  fax({
    id: "fx-referral",
    inboxId: "fax-records",
    direction: "outbound",
    appNumber: "+16285550150",
    peerNumber: "+12125550199",
    title: "Patient referral, R. Okafor",
    pages: 3,
    status: "delivered",
    read: false,
    events: [
      { event: "fax.queued", at: minutesAgo(27) },
      { event: "fax.media.processed", at: minutesAgo(27) },
      { event: "fax.sending.started", at: minutesAgo(26) },
      { event: "fax.delivered", at: minutesAgo(26) },
    ],
    createdAt: minutesAgo(27),
  }),
  fax({
    id: "fx-consent",
    inboxId: "fax-records",
    direction: "inbound",
    appNumber: "+16285550150",
    peerNumber: "+12125550199",
    title: "Signed consent form",
    pages: 2,
    status: "received",
    events: [{ event: "fax.received", at: minutesAgo(62) }],
    createdAt: minutesAgo(62),
  }),
  fax({
    id: "fx-laborder",
    inboxId: "fax-lab",
    direction: "outbound",
    appNumber: "+16285550150",
    peerNumber: "+13125550164",
    title: "Lab order A-55821",
    pages: 1,
    quality: "normal",
    status: "delivered",
    events: [
      { event: "fax.queued", at: minutesAgo(124) },
      { event: "fax.media.processed", at: minutesAgo(124) },
      { event: "fax.sending.started", at: minutesAgo(123) },
      { event: "fax.delivered", at: minutesAgo(123) },
    ],
    createdAt: minutesAgo(124),
  }),
]

/* --------------------------------------------------------------- webhooks */

const URLS = {
  mailgunRoute: "http://localhost:3000/webhooks/mailgun/inbound",
  mailgunEvents: "http://localhost:3000/webhooks/mailgun/events",
  telnyxMessaging: "http://localhost:3000/webhooks/telnyx/messaging",
  telnyxFax: "http://localhost:3000/webhooks/telnyx/fax",
}

const allItems: ChannelItem[] = [...seedEmails, ...seedSms, ...seedFaxes]
const byId = (id: string) => allItems.find((i) => i.id === id)!

function hook(
  id: string,
  relatedId: string,
  event: string,
  url: string,
  min: number,
  result: {
    status: number | null
    ms: number
    attempt?: number
    max?: number
    response?: string
    error?: string
  }
): WebhookDelivery {
  const item = byId(relatedId)
  const at = minutesAgo(min)
  const built = buildWebhook(
    item.adapterId,
    event,
    item,
    at,
    result.attempt ?? 1,
    url
  )
  return {
    id,
    adapterId: item.adapterId,
    channel: item.channel,
    event,
    url,
    status: result.status,
    durationMs: result.ms,
    attempt: result.attempt ?? 1,
    maxAttempts: result.max ?? 3,
    createdAt: at,
    relatedId,
    requestHeaders: built.headers,
    requestBody: built.body,
    responseBody: result.response,
    error: result.error,
  }
}

const crash = `{
  "error": "TypeError: Cannot read properties of undefined (reading 'url')",
  "at": "handleInboundMms (src/webhooks/telnyx.ts:48:31)"
}`

export const seedWebhooks: WebhookDelivery[] = [
  hook("wh-15", "em-welcome", "delivered", URLS.mailgunEvents, 1, {
    status: 200,
    ms: 18,
    response: "OK",
  }),
  hook("wh-14", "sm-9", "message.received", URLS.telnyxMessaging, 3, {
    status: 500,
    ms: 41,
    attempt: 3,
    response: crash,
  }),
  hook("wh-13", "sm-6", "message.received", URLS.telnyxMessaging, 4, {
    status: 200,
    ms: 22,
    response: '{"ok":true}',
  }),
  hook("wh-12", "sm-9", "message.received", URLS.telnyxMessaging, 5, {
    status: 500,
    ms: 39,
    attempt: 2,
    response: crash,
  }),
  hook("wh-11", "em-verify", "delivered", URLS.mailgunEvents, 6, {
    status: 200,
    ms: 15,
    response: "OK",
  }),
  hook("wh-10", "sm-9", "message.received", URLS.telnyxMessaging, 7, {
    status: 500,
    ms: 57,
    attempt: 1,
    response: crash,
  }),
  hook("wh-9", "fx-priorauth", "fax.failed", URLS.telnyxFax, 7, {
    status: 200,
    ms: 25,
    response: '{"ok":true}',
  }),
  hook("wh-8", "em-payfail", "permanent_fail", URLS.mailgunEvents, 9, {
    status: 200,
    ms: 19,
    response: "OK",
  }),
  hook("wh-7", "em-question", "route.forward", URLS.mailgunRoute, 11, {
    status: 200,
    ms: 64,
    attempt: 2,
    response: '{"ticket":"T-3318"}',
  }),
  hook("wh-6", "em-question", "route.forward", URLS.mailgunRoute, 12, {
    status: null,
    ms: 3,
    attempt: 1,
    error: "connect ECONNREFUSED 127.0.0.1:3000",
  }),
  hook("wh-5", "sm-5", "message.finalized", URLS.telnyxMessaging, 15, {
    status: 200,
    ms: 12,
    response: '{"ok":true}',
  }),
  hook("wh-4", "sm-3", "message.received", URLS.telnyxMessaging, 21, {
    status: 200,
    ms: 33,
    response: '{"ok":true}',
  }),
  hook("wh-3", "fx-referral", "fax.delivered", URLS.telnyxFax, 26, {
    status: 200,
    ms: 21,
    response: '{"ok":true}',
  }),
  hook("wh-2", "em-reply-reset", "route.forward", URLS.mailgunRoute, 41, {
    status: 200,
    ms: 48,
    response: '{"ticket":"T-3301"}',
  }),
  hook("wh-1", "fx-consent", "fax.received", URLS.telnyxFax, 62, {
    status: 200,
    ms: 88,
    response: '{"ok":true}',
  }),
]

/* ----------------------------------------------------------- api requests */

const mgSend = (to: string, subject: string) =>
  `from=Acme <noreply@mg.acme.test>\nto=${to}\nsubject=${subject}\ntext=…\nhtml=…\no:tag=…`
const mgOk = (id: string) =>
  JSON.stringify(
    {
      id:
        byId(id).channel === "email"
          ? (byId(id) as EmailMessage).messageId
          : id,
      message: "Queued. Thank you.",
    },
    null,
    2
  )

const txSend = (id: string) => {
  const m = byId(id) as SmsMessage
  return JSON.stringify(
    { from: m.appNumber, to: m.peerNumber, text: m.body },
    null,
    2
  )
}
const txOk = (id: string) => {
  const m = byId(id) as SmsMessage
  return JSON.stringify(
    {
      data: {
        record_type: "message",
        id: m.providerId,
        direction: "outbound",
        type: "SMS",
        parts: m.parts,
        to: [{ phone_number: m.peerNumber, status: "queued" }],
      },
    },
    null,
    2
  )
}

export const seedRequests: ApiRequest[] = [
  {
    id: "rq-16",
    adapterId: "mailgun",
    method: "POST",
    path: "/v3/mg.acme.test/messages",
    status: 200,
    durationMs: 9,
    createdAt: minutesAgo(1),
    relatedId: "em-welcome",
    requestBody: mgSend("agent-1@inbox.test", "Welcome to Acme, Riley"),
    responseBody: mgOk("em-welcome"),
  },
  {
    id: "rq-15",
    adapterId: "mailgun",
    method: "POST",
    path: "/v3/mg.acme.test/messages",
    status: 200,
    durationMs: 11,
    createdAt: minutesAgo(6),
    relatedId: "em-verify",
    requestBody: mgSend("agent-1@inbox.test", "Confirm your email address"),
    responseBody: mgOk("em-verify"),
  },
  {
    id: "rq-14",
    adapterId: "mailgun",
    method: "POST",
    path: "/v3/mg.acme.test/messages",
    status: 200,
    durationMs: 8,
    createdAt: minutesAgo(9),
    relatedId: "em-payfail",
    requestBody: mgSend(
      "agent-2@inbox.test",
      "Payment failed for card ending 4242"
    ),
    responseBody: mgOk("em-payfail"),
  },
  {
    id: "rq-13",
    adapterId: "telnyx",
    method: "POST",
    path: "/v2/messages",
    status: 200,
    durationMs: 14,
    createdAt: minutesAgo(9),
    relatedId: "sm-8",
    requestBody: txSend("sm-8"),
    responseBody: txOk("sm-8"),
  },
  {
    id: "rq-12",
    adapterId: "telnyx",
    method: "POST",
    path: "/v2/faxes",
    status: 202,
    durationMs: 31,
    createdAt: minutesAgo(8),
    relatedId: "fx-priorauth",
    requestBody: JSON.stringify(
      {
        connection_id: "local-fax-app",
        from: "+16285550150",
        to: "+12125550199",
        media_url: "http://localhost:3000/files/prior-auth-7731.pdf",
      },
      null,
      2
    ),
    responseBody: JSON.stringify(
      {
        data: {
          record_type: "fax",
          id: uuid("fx-priorauth"),
          status: "queued",
        },
      },
      null,
      2
    ),
  },
  {
    id: "rq-11",
    adapterId: "telnyx",
    method: "GET",
    path: `/v2/faxes/${uuid("fx-priorauth")}`,
    status: 200,
    durationMs: 4,
    createdAt: minutesAgo(7),
    relatedId: "fx-priorauth",
    responseBody: JSON.stringify(
      {
        data: {
          record_type: "fax",
          id: uuid("fx-priorauth"),
          status: "failed",
          failure_reason: "user_busy",
          page_count: 2,
        },
      },
      null,
      2
    ),
  },
  {
    id: "rq-10",
    adapterId: "mailgun",
    method: "POST",
    path: "/v3/mg.acme.test/messages",
    status: 200,
    durationMs: 12,
    createdAt: minutesAgo(18),
    relatedId: "em-invoice",
    requestBody:
      mgSend("agent-2@inbox.test", "Your invoice INV-2041 is ready") +
      "\nattachment=@INV-2041.pdf",
    responseBody: mgOk("em-invoice"),
  },
  {
    id: "rq-9",
    adapterId: "telnyx",
    method: "POST",
    path: "/v2/messages",
    status: 200,
    durationMs: 10,
    createdAt: minutesAgo(15),
    relatedId: "sm-5",
    requestBody: txSend("sm-5"),
    responseBody: txOk("sm-5"),
  },
  {
    id: "rq-8",
    adapterId: "mailgun",
    method: "POST",
    path: "/v3/mg.acme.test/messages",
    status: 200,
    durationMs: 10,
    createdAt: minutesAgo(25),
    relatedId: "em-invite",
    requestBody: mgSend(
      "sam@contractor.dev",
      "Riley Chen invited you to the Northwind workspace"
    ),
    responseBody: mgOk("em-invite"),
  },
  {
    id: "rq-7",
    adapterId: "telnyx",
    method: "POST",
    path: "/v2/messages",
    status: 200,
    durationMs: 9,
    createdAt: minutesAgo(21),
    relatedId: "sm-4",
    requestBody: txSend("sm-4"),
    responseBody: txOk("sm-4"),
  },
  {
    id: "rq-6",
    adapterId: "telnyx",
    method: "POST",
    path: "/v2/messages",
    status: 200,
    durationMs: 13,
    createdAt: minutesAgo(22),
    relatedId: "sm-2",
    requestBody: txSend("sm-2"),
    responseBody: txOk("sm-2"),
  },
  {
    id: "rq-5",
    adapterId: "telnyx",
    method: "POST",
    path: "/v2/faxes",
    status: 202,
    durationMs: 28,
    createdAt: minutesAgo(27),
    relatedId: "fx-referral",
    requestBody: JSON.stringify(
      {
        connection_id: "local-fax-app",
        from: "+16285550150",
        to: "+12125550199",
        media_url: "http://localhost:3000/files/referral-okafor.pdf",
      },
      null,
      2
    ),
    responseBody: JSON.stringify(
      {
        data: { record_type: "fax", id: uuid("fx-referral"), status: "queued" },
      },
      null,
      2
    ),
  },
  {
    id: "rq-4",
    adapterId: "telnyx",
    method: "POST",
    path: "/v2/messages",
    status: 422,
    durationMs: 3,
    createdAt: minutesAgo(35),
    requestBody: JSON.stringify(
      {
        from: "+16285550100",
        to: "4155550142",
        text: "Acme: your verification code is 731604.",
      },
      null,
      2
    ),
    responseBody: JSON.stringify(
      {
        errors: [
          {
            code: "40310",
            title: "Invalid 'to' address",
            detail: "The 'to' address should be in E.164 format.",
            source: { pointer: "/to" },
          },
        ],
      },
      null,
      2
    ),
  },
  {
    id: "rq-3",
    adapterId: "telnyx",
    method: "POST",
    path: "/v2/messages",
    status: 200,
    durationMs: 11,
    createdAt: minutesAgo(34),
    relatedId: "sm-1",
    requestBody: txSend("sm-1"),
    responseBody: txOk("sm-1"),
  },
  {
    id: "rq-2",
    adapterId: "mailgun",
    method: "GET",
    path: "/v3/mg.acme.test/events?event=delivered&limit=25",
    status: 200,
    durationMs: 6,
    createdAt: minutesAgo(30),
    responseBody: JSON.stringify(
      {
        items: [{ event: "delivered", recipient: "qa@inbox.test" }],
        paging: {
          next: "http://127.0.0.1:4101/v3/mg.acme.test/events/WzMsIFsiMjAyNi0xMS0xMSJdXQ==",
        },
      },
      null,
      2
    ),
  },
  {
    id: "rq-1",
    adapterId: "mailgun",
    method: "POST",
    path: "/v3/acme.test/messages",
    status: 404,
    durationMs: 2,
    createdAt: minutesAgo(52),
    requestBody: mgSend("qa@inbox.test", "Reset your password"),
    responseBody: JSON.stringify(
      { message: "Domain not found: acme.test" },
      null,
      2
    ),
  },
]

/* ------------------------------------------------------------ app numbers */

/** Numbers the app under test owns on Telnyx, with what they're used for. */
export const appNumbers: Record<string, string> = {
  "+16285550100": "Verify & support",
  "+16285550111": "Order alerts",
  "+16285550150": "Fax line",
}
