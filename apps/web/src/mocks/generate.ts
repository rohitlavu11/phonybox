/**
 * Deterministic load-test data: thousands of inboxes shaped like the output of
 * real agent test runs. Same seed, same data, so screenshots and bug reports
 * are reproducible.
 *
 * Heavy fields (email HTML, headers, webhook bodies) are not built here. The
 * DB renders them on first read, the same way a real server would only load a
 * message body when it's opened.
 */
import { minutesAgo } from "@/lib/format"
import type {
  ApiRequest,
  Attachment,
  ChannelItem,
  EmailMessage,
  FaxDocument,
  Inbox,
  SmsMessage,
  WebhookDelivery,
} from "@/types/domain"
import { emailHtml, headersFor } from "@/mocks/seed"
import { hex, uuid } from "@/mocks/payloads"

export interface Generated {
  inboxes: Inbox[]
  items: ChannelItem[]
  /** Fields rendered on first read. */
  lazy: Map<string, (item: ChannelItem) => Partial<ChannelItem>>
  webhooks: WebhookDelivery[]
  requests: ApiRequest[]
}

export const SIZES = { email: 2400, sms: 800, fax: 300 }

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const URL = {
  mgEvents: "http://localhost:3000/webhooks/mailgun/events",
  mgRoute: "http://localhost:3000/webhooks/mailgun/inbound",
  txMsg: "http://localhost:3000/webhooks/telnyx/messaging",
  txFax: "http://localhost:3000/webhooks/telnyx/fax",
}

const FIRST = [
  "Riley",
  "Sam",
  "Jordan",
  "Priya",
  "Mateo",
  "Aisha",
  "Wei",
  "Noah",
  "Elena",
  "Kofi",
  "Hana",
  "Lucas",
  "Zara",
  "Diego",
  "Mira",
  "Owen",
]
const LAST = [
  "Chen",
  "Okafor",
  "Garcia",
  "Patel",
  "Nguyen",
  "Kim",
  "Silva",
  "Novak",
  "Haddad",
  "Brown",
  "Ito",
  "Mensah",
  "Rossi",
  "Larsen",
]
const WORKSPACES = [
  "Northwind",
  "Globex",
  "Initech",
  "Umbrella",
  "Hooli",
  "Vandelay",
  "Stark Labs",
  "Wayne Ent.",
]

export function generate(seed = 7): Generated {
  const r = mulberry32(seed)
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)]
  const int = (min: number, max: number) =>
    min + Math.floor(r() * (max - min + 1))
  const chance = (p: number) => r() < p

  const out: Generated = {
    inboxes: [],
    items: [],
    lazy: new Map(),
    webhooks: [],
    requests: [],
  }
  let n = 0
  const id = (p: string) => `${p}${(n++).toString(36)}`

  function webhook(
    item: ChannelItem,
    event: string,
    url: string,
    at: number,
    failRate: number
  ) {
    const fails = chance(failRate)
    const attempts = fails ? 3 : chance(0.04) ? 2 : 1
    for (let a = 1; a <= attempts; a++) {
      const last = a === attempts
      const ok = last && !fails
      const status = ok ? 200 : chance(0.3) ? null : pick([500, 502, 503])
      out.webhooks.push({
        id: id("gwh-"),
        adapterId: item.adapterId,
        channel: item.channel,
        event,
        url,
        status,
        durationMs: status === null ? int(1, 4) : int(8, 90),
        attempt: a,
        maxAttempts: 3,
        createdAt: minutesAgo(Math.max(0, at - a * 0.5)),
        relatedId: item.id,
        requestHeaders: [],
        requestBody: "",
        responseBody:
          status === null
            ? undefined
            : ok
              ? '{"ok":true}'
              : '{"error":"Internal Server Error"}',
        error:
          status === null ? "connect ECONNREFUSED 127.0.0.1:3000" : undefined,
      })
    }
  }

  function request(
    item: ChannelItem,
    method: "POST",
    path: string,
    status: number,
    at: number
  ) {
    out.requests.push({
      id: id("grq-"),
      adapterId: item.adapterId,
      method,
      path,
      status,
      durationMs: int(3, 30),
      createdAt: minutesAgo(at + 0.05),
      relatedId: item.id,
    })
  }

  /* ------------------------------------------------------------ email */

  type Tpl = {
    subject: string
    text: string
    heading: string
    paras: string[]
    code?: string
    cta?: { label: string; href: string }
    tags: string[]
    attachments?: Attachment[]
    from?: { name: string; address: string }
  }

  const acme = { name: "Acme", address: "noreply@mg.acme.test" }
  const billing = { name: "Acme Billing", address: "billing@mg.acme.test" }

  const outbound: Record<string, () => Tpl[]> = {
    signup: () => {
      const code = String(int(100000, 999999))
      const tok = hex(code, 12)
      const list: Tpl[] = [
        {
          subject: "Confirm your email address",
          text: `Enter this verification code to finish signing up:\n\n${code.slice(0, 3)} ${code.slice(3)}\n\nOr open http://localhost:3000/verify?token=evt_${tok}`,
          heading: "Confirm your email address",
          paras: ["Enter this verification code to finish signing up:"],
          code: `${code.slice(0, 3)} ${code.slice(3)}`,
          cta: {
            label: "Confirm email",
            href: `http://localhost:3000/verify?token=evt_${tok}`,
          },
          tags: ["verify-email"],
        },
      ]
      if (chance(0.8))
        list.push({
          subject: `Welcome to Acme, ${pick(FIRST)}`,
          text: "Your email is confirmed and your workspace is ready.\n\nInvite your team: http://localhost:3000/settings/members",
          heading: "Welcome to Acme",
          paras: ["Your email is confirmed and your workspace is ready."],
          cta: {
            label: "Invite your team",
            href: "http://localhost:3000/settings/members",
          },
          tags: ["onboarding"],
        })
      return list
    },
    checkout: () => {
      const order = int(10000, 99999)
      const list: Tpl[] = [
        {
          subject: `Order #${order} confirmed`,
          text: `Thanks for your order #${order}.\n\n2 items · $${int(20, 400)}.00\n\nView it: http://localhost:3000/orders/${order}`,
          heading: `Order #${order} confirmed`,
          paras: ["Thanks for your order. We'll email you when it ships."],
          cta: {
            label: "View order",
            href: `http://localhost:3000/orders/${order}`,
          },
          tags: ["order"],
        },
      ]
      if (chance(0.55))
        list.push({
          subject: `Order #${order} has shipped`,
          text: `Track it: http://localhost:3000/t/${order}`,
          heading: "On its way",
          paras: [`Order #${order} left our warehouse.`],
          cta: {
            label: "Track package",
            href: `http://localhost:3000/t/${order}`,
          },
          tags: ["shipping"],
        })
      return list
    },
    billing: () => {
      const inv = `INV-${int(1000, 9999)}`
      const list: Tpl[] = [
        {
          subject: `Your invoice ${inv} is ready`,
          text: `Invoice ${inv} is attached.\n\nView online: http://localhost:3000/billing/invoices/${inv}`,
          heading: `Invoice ${inv}`,
          paras: [`Your invoice for <b>$${int(49, 999)}.00</b> is attached.`],
          cta: {
            label: "View invoice",
            href: `http://localhost:3000/billing/invoices/${inv}`,
          },
          tags: ["billing", "invoice"],
          attachments: [
            {
              filename: `${inv}.pdf`,
              contentType: "application/pdf",
              size: int(30000, 90000),
            },
          ],
          from: billing,
        },
      ]
      if (chance(0.3))
        list.push({
          subject: "Payment failed for card ending 4242",
          text: `We couldn't charge your card for ${inv}.\n\nUpdate it: http://localhost:3000/billing/payment-method`,
          heading: "Payment failed",
          paras: [`We couldn't charge your card for invoice <b>${inv}</b>.`],
          cta: {
            label: "Update payment method",
            href: "http://localhost:3000/billing/payment-method",
          },
          tags: ["billing", "dunning"],
          from: billing,
        })
      return list
    },
    invite: () => {
      const ws = pick(WORKSPACES)
      const code = hex(String(r()), 8)
      return [
        {
          subject: `${pick(FIRST)} ${pick(LAST)} invited you to ${ws}`,
          text: `Accept the invite: http://localhost:3000/invite/inv_${code}\n\nThis invite expires in 7 days.`,
          heading: `Join ${ws} on Acme`,
          paras: ["This invite expires in 7 days."],
          cta: {
            label: "Accept invite",
            href: `http://localhost:3000/invite/inv_${code}`,
          },
          tags: ["invite"],
        },
      ]
    },
    reset: () => {
      const tok = hex(String(r()), 8)
      return [
        {
          subject: "Reset your password",
          text: `Reset it here: http://localhost:3000/reset?token=rst_${tok}\n\nThe link works for 30 minutes.`,
          heading: "Reset your password",
          paras: ["The link works for 30 minutes."],
          cta: {
            label: "Choose a new password",
            href: `http://localhost:3000/reset?token=rst_${tok}`,
          },
          tags: ["auth"],
        },
      ]
    },
    onboarding: () => [
      {
        subject: "Finish setting up your workspace",
        text: "Two steps left: connect a data source and invite a teammate.\n\nhttp://localhost:3000/setup",
        heading: "Two steps left",
        paras: ["Connect a data source and invite a teammate."],
        cta: { label: "Continue setup", href: "http://localhost:3000/setup" },
        tags: ["onboarding"],
      },
      ...(chance(0.5)
        ? [
            {
              subject: "3 things teams do in their first week",
              text: "Templates, shared views and the Slack integration.\n\nhttp://localhost:3000/guides",
              heading: "Your first week",
              paras: ["Templates, shared views and the Slack integration."],
              tags: ["onboarding", "drip"],
            },
          ]
        : []),
    ],
    digest: () => [
      {
        subject: `Your week in ${pick(WORKSPACES)}: ${int(3, 40)} tasks closed`,
        text: "Open your dashboard: http://localhost:3000/w",
        heading: "Your week",
        paras: [`${int(3, 40)} tasks closed · ${int(0, 6)} new members`],
        cta: { label: "Open dashboard", href: "http://localhost:3000/w" },
        tags: ["digest"],
      },
    ],
    support: () => [
      {
        subject: `Re: Ticket T-${int(3000, 9999)}`,
        text: "Thanks for the details. We've reproduced it and a fix is rolling out today.",
        heading: "We're on it",
        paras: [
          "Thanks for the details. We've reproduced it and a fix is rolling out today.",
        ],
        tags: ["support"],
      },
    ],
  }

  const inboundSubjects: Record<string, string[]> = {
    billing: [
      "Question about my invoice",
      "Wrong seat count on invoice",
      "Can I get a receipt?",
    ],
    reset: ["Re: Reset your password", "Reset link expired"],
    support: [
      "Can't export to CSV",
      "Login loop on Safari",
      "Webhook retries look wrong",
    ],
  }

  const suites = Object.keys(outbound)
  let run = 4200
  const runLabel: Record<string, string> = {
    signup: "Signup",
    checkout: "Checkout",
    billing: "Billing",
    invite: "Invite",
    reset: "Password reset",
    onboarding: "Onboarding",
    digest: "Digest",
    support: "Support",
  }

  while (
    out.inboxes.filter((i) => i.channel === "email").length < SIZES.email
  ) {
    run--
    const suite = pick(suites)
    const agents = int(1, 5)
    const runAge = 90 + (4200 - run) * int(5, 12)
    for (let a = 1; a <= agents; a++) {
      const address = `${suite}-${run}-${a}@inbox.test`
      const inbox: Inbox = {
        id: `${suite}-${run}-${a}`,
        channel: "email",
        address,
        label: `${runLabel[suite]} · run ${run}${agents > 1 ? ` · #${a}` : ""}`,
        adapterId: "mailgun",
        tags: [`suite:${suite}`, `run:${run}`],
        createdBy: "agent",
        createdAt: minutesAgo(runAge),
      }
      out.inboxes.push(inbox)

      let t = runAge - 0.3
      const tpls = outbound[suite]()
      for (const tpl of tpls) {
        t -= r() * 2 + 0.2
        const from = tpl.from ?? acme
        const m: Omit<EmailMessage, "headers"> = {
          id: id("gem-"),
          channel: "email",
          inboxId: inbox.id,
          adapterId: "mailgun",
          direction: "outbound",
          messageId: `<${hex(address + t, 14)}.${hex(tpl.subject, 10)}@mg.acme.test>`,
          from,
          to: [{ address }],
          subject: tpl.subject,
          text: tpl.text,
          attachments: tpl.attachments ?? [],
          tags: tpl.tags,
          status:
            tpl.tags.includes("dunning") && chance(0.5)
              ? "bounced"
              : "delivered",
          read: runAge > 400 ? true : chance(0.35),
          createdAt: minutesAgo(t),
        }
        const item = { ...m, headers: [] } as EmailMessage
        out.items.push(item)
        out.lazy.set(item.id, (cur) => ({
          html: emailHtml({
            heading: tpl.heading,
            paras: tpl.paras,
            code: tpl.code,
            cta: tpl.cta,
          }),
          headers: headersFor(cur as EmailMessage),
        }))
        request(item, "POST", "/v3/mg.acme.test/messages", 200, t)
        webhook(
          item,
          item.status === "bounced" ? "permanent_fail" : "delivered",
          URL.mgEvents,
          t - 0.05,
          0.01
        )
      }

      if (inboundSubjects[suite] && chance(0.35)) {
        t -= r() * 4 + 1
        const subject = pick(inboundSubjects[suite])
        const item: EmailMessage = {
          id: id("gem-"),
          channel: "email",
          inboxId: inbox.id,
          adapterId: "mailgun",
          direction: "inbound",
          messageId: `<${hex(address + subject, 16)}@inbox.test>`,
          from: { name: inbox.label, address },
          to: [
            {
              address:
                suite === "billing"
                  ? "billing@mg.acme.test"
                  : "support@mg.acme.test",
            },
          ],
          subject,
          text: `Hi,\n\n${subject}. Steps are in the run log for run ${run}.\n\nThanks`,
          attachments: [],
          headers: [],
          tags: [],
          status: "delivered",
          read: true,
          createdAt: minutesAgo(t),
        }
        out.items.push(item)
        out.lazy.set(item.id, (cur) => ({
          headers: headersFor(cur as EmailMessage),
        }))
        webhook(item, "route.forward", URL.mgRoute, t - 0.05, 0.06)
      }
    }
  }

  /* -------------------------------------------------------------- sms */

  const smsAreas = [
    "415",
    "628",
    "650",
    "408",
    "510",
    "707",
    "925",
    "212",
    "646",
    "718",
    "917",
    "312",
    "773",
    "206",
    "303",
    "512",
    "617",
    "702",
    "213",
    "310",
  ]
  const taken = new Set(["+14155550142", "+14155550177"])
  const smsSuites = [
    "2fa",
    "delivery",
    "appointments",
    "support",
    "marketing",
  ] as const
  const smsLabel = {
    "2fa": "2FA",
    delivery: "Delivery",
    appointments: "Appointments",
    support: "Support",
    marketing: "Promo",
  }

  for (let i = 0; out.inboxes.length < SIZES.email + SIZES.sms; i++) {
    const number = `+1${smsAreas[i % smsAreas.length]}55501${String(Math.floor(i / smsAreas.length)).padStart(2, "0")}`
    if (taken.has(number)) continue
    const suite = pick(smsSuites)
    const srun = int(800, 1400)
    const age = int(100, 8000)
    const inbox: Inbox = {
      id: `n-${number.slice(2)}`,
      channel: "sms",
      address: number,
      label: `${smsLabel[suite]} · run ${srun}`,
      adapterId: "telnyx",
      tags: [`suite:${suite}`, `run:${srun}`],
      createdBy: "agent",
      createdAt: minutesAgo(age),
    }
    out.inboxes.push(inbox)

    let t = age - 0.5
    const say = (
      direction: "outbound" | "inbound",
      appNumber: string,
      body: string,
      note?: string
    ) => {
      t -= r() * 3 + 0.3
      const item: SmsMessage = {
        id: id("gsm-"),
        channel: "sms",
        inboxId: inbox.id,
        adapterId: "telnyx",
        direction,
        providerId: uuid(inbox.id + t),
        appNumber,
        peerNumber: number,
        body,
        media: [],
        parts: Math.max(1, Math.ceil(body.length / 153)),
        status:
          direction === "outbound"
            ? chance(0.02)
              ? "failed"
              : "delivered"
            : "received",
        read: direction === "inbound" || age > 600 ? true : chance(0.4),
        createdAt: minutesAgo(t),
        note,
      }
      out.items.push(item)
      if (direction === "outbound") {
        request(item, "POST", "/v2/messages", 200, t)
        if (chance(0.5))
          webhook(item, "message.finalized", URL.txMsg, t - 0.05, 0.01)
      } else {
        webhook(item, "message.received", URL.txMsg, t - 0.05, 0.04)
      }
    }

    const verify = "+16285550100"
    const alerts = "+16285550111"
    if (suite === "2fa") {
      say(
        "outbound",
        verify,
        `Acme: your verification code is ${int(100000, 999999)}. It expires in 10 minutes.`
      )
      if (chance(0.3))
        say(
          "outbound",
          verify,
          `Acme: your verification code is ${int(100000, 999999)}. It expires in 10 minutes.`
        )
    } else if (suite === "delivery") {
      const order = int(10000, 99999)
      say(
        "outbound",
        alerts,
        `Acme: order #${order} has shipped. Track it at http://localhost:3000/t/${order}`
      )
      if (chance(0.25)) {
        say("inbound", alerts, "STOP")
        say(
          "outbound",
          alerts,
          "You have been unsubscribed and will not receive more messages from this number. Reply START to resubscribe.",
          "Automatic opt-out reply."
        )
      }
    } else if (suite === "appointments") {
      say(
        "outbound",
        verify,
        `Acme: your call is ${pick(["Mon", "Tue", "Wed", "Thu", "Fri"])} at ${int(9, 4 + 12) % 12 || 12}:${pick(["00", "30"])} PM. Reply C to confirm or R to reschedule.`
      )
      if (chance(0.7)) {
        const reply = pick(["C", "R", "c", "Confirm", "can we do later?"])
        say("inbound", verify, reply)
        say(
          "outbound",
          verify,
          /^c/i.test(reply)
            ? "Thanks, you're confirmed."
            : "No problem. Pick a new time: http://localhost:3000/reschedule"
        )
      }
    } else if (suite === "support") {
      say(
        "outbound",
        verify,
        "Acme support: reply here with your order number and we'll take a look."
      )
      say("inbound", verify, `#${int(10000, 99999)}, it never arrived`)
      if (chance(0.6))
        say("outbound", verify, "Thanks. A replacement ships today.")
    } else {
      say(
        "outbound",
        alerts,
        `Acme: ${int(10, 30)}% off annual plans this week. http://localhost:3000/upgrade Reply STOP to opt out.`
      )
      if (chance(0.15)) say("inbound", alerts, "STOP")
    }
  }

  /* -------------------------------------------------------------- fax */

  const faxAreas = [
    "212",
    "718",
    "312",
    "617",
    "415",
    "510",
    "206",
    "303",
    "404",
    "305",
    "214",
    "602",
  ]
  const depts = [
    "Records desk",
    "Lab intake",
    "Radiology",
    "Billing office",
    "Pharmacy",
    "Referrals",
    "Cardiology",
    "Admissions",
    "Oncology",
    "Pediatrics",
  ]
  const cities = [
    "Oakland",
    "Brooklyn",
    "Evanston",
    "Cambridge",
    "Daly City",
    "Tacoma",
    "Boulder",
    "Decatur",
    "Miami",
    "Plano",
    "Mesa",
    "Queens",
    "Berkeley",
  ]
  const faxTaken = new Set(["+12125550199", "+13125550164"])
  const titles = [
    () => `Patient referral, ${pick(FIRST)[0]}. ${pick(LAST)}`,
    () => `Lab order A-${int(10000, 99999)}`,
    () => "Prior authorization request",
    () => "Medical records request",
    () => "Discharge summary",
  ]

  for (
    let i = 0;
    out.inboxes.length < SIZES.email + SIZES.sms + SIZES.fax;
    i++
  ) {
    const number = `+1${faxAreas[i % faxAreas.length]}55501${String(Math.floor(i / faxAreas.length)).padStart(2, "0")}`
    if (faxTaken.has(number)) continue
    const age = int(200, 9000)
    const inbox: Inbox = {
      id: `f-${number.slice(2)}`,
      channel: "fax",
      address: number,
      label: `${pick(depts)} · ${pick(cities)}`,
      adapterId: "telnyx",
      tags: ["suite:fax"],
      createdBy: "seed",
      createdAt: minutesAgo(age),
    }
    out.inboxes.push(inbox)

    let t = age - 1
    const count = int(0, 4)
    for (let k = 0; k < count; k++) {
      t -= r() * 30 + 1
      const inbound = chance(0.2)
      const failed = !inbound && chance(0.06)
      const at = t
      const item: FaxDocument = {
        id: id("gfx-"),
        channel: "fax",
        inboxId: inbox.id,
        adapterId: "telnyx",
        direction: inbound ? "inbound" : "outbound",
        providerId: uuid(inbox.id + k),
        appNumber: "+16285550150",
        peerNumber: number,
        title: inbound
          ? pick([
              "Signed consent form",
              "Completed intake form",
              "Insurance card copy",
            ])
          : pick(titles)(),
        pages: int(1, 6),
        quality: pick(["normal", "high", "high", "very_high"] as const),
        status: inbound ? "received" : failed ? "failed" : "delivered",
        failureReason: failed
          ? pick(["user_busy", "no_answer", "receiver_call_dropped"])
          : undefined,
        events: inbound
          ? [{ event: "fax.received", at: minutesAgo(at) }]
          : [
              { event: "fax.queued", at: minutesAgo(at) },
              { event: "fax.media.processed", at: minutesAgo(at - 0.1) },
              { event: "fax.sending.started", at: minutesAgo(at - 0.3) },
              {
                event: failed ? "fax.failed" : "fax.delivered",
                at: minutesAgo(at - 1),
              },
            ],
        read: age > 600 || inbound ? true : chance(0.4),
        createdAt: minutesAgo(at),
      }
      out.items.push(item)
      if (inbound) webhook(item, "fax.received", URL.txFax, at - 0.1, 0.03)
      else {
        request(item, "POST", "/v2/faxes", 202, at)
        webhook(
          item,
          failed ? "fax.failed" : "fax.delivered",
          URL.txFax,
          at - 1,
          0.01
        )
      }
    }
  }

  return out
}
