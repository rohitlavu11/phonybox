import type {
  ChannelItem,
  EmailMessage,
  FaxDocument,
  SmsMessage,
} from "@/types/domain"

/** Deterministic pseudo-random hex so the seed is stable between reloads. */
export function hex(seed: string, len = 32) {
  let h = 2166136261
  let out = ""
  while (out.length < len) {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    out += (h >>> 0).toString(16).padStart(8, "0")
    seed += out
  }
  return out.slice(0, len)
}

export function uuid(seed: string) {
  const h = hex(seed, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)
const json = (v: unknown) => JSON.stringify(v, null, 2)

interface Built {
  headers: [string, string][]
  body: string
}

function telnyx(
  event: string,
  item: SmsMessage | FaxDocument,
  at: string,
  attempt: number,
  url: string
): Built {
  const payload =
    item.channel === "sms"
      ? {
          direction: item.direction,
          from: {
            carrier: "phonybox",
            line_type: item.direction === "inbound" ? "Wireless" : "Long Code",
            phone_number:
              item.direction === "inbound" ? item.peerNumber : item.appNumber,
          },
          id: item.providerId,
          media: item.media.map((m, i) => ({
            content_type: m.contentType,
            size: m.size,
            url: `http://127.0.0.1:4102/media/${hex(item.id + i, 12)}/${m.filename}`,
          })),
          messaging_profile_id: "40017f3a-5b8e-4c1d-9a7e-2f6b1c0d8e44",
          parts: item.parts,
          received_at: item.createdAt,
          record_type: "message",
          text: item.body,
          to: [
            {
              phone_number:
                item.direction === "inbound" ? item.appNumber : item.peerNumber,
              status:
                item.direction === "inbound"
                  ? "webhook_delivered"
                  : item.status,
            },
          ],
          type: item.media.length ? "MMS" : "SMS",
        }
      : {
          connection_id: "local-fax-app",
          direction: item.direction,
          fax_id: item.providerId,
          from: item.direction === "inbound" ? item.peerNumber : item.appNumber,
          to: item.direction === "inbound" ? item.appNumber : item.peerNumber,
          page_count: item.pages,
          quality: item.quality,
          status: event.replace("fax.", ""),
          ...(item.failureReason ? { failure_reason: item.failureReason } : {}),
          ...(item.direction === "inbound"
            ? {
                media_url: `http://127.0.0.1:4102/media/${hex(item.id, 12)}.pdf`,
              }
            : {}),
        }

  return {
    headers: [
      ["content-type", "application/json"],
      ["user-agent", "telnyx-webhooks (phonybox)"],
      ["telnyx-timestamp", String(unix(at))],
      ["telnyx-signature-ed25519", hex(item.id + event + attempt, 64) + "=="],
    ],
    body: json({
      data: {
        event_type: event,
        id: uuid(item.id + event),
        occurred_at: at,
        payload,
        record_type: "event",
      },
      meta: { attempt, delivered_to: url },
    }),
  }
}

function mailgun(event: string, item: EmailMessage, at: string): Built {
  const ts = String(unix(at))
  const token = hex(item.id + event, 50)
  const signature = hex(token + ts, 64)

  if (event === "route.forward") {
    const fields: [string, string][] = [
      ["recipient", item.to[0]?.address ?? ""],
      ["sender", item.from.address],
      [
        "from",
        item.from.name
          ? `${item.from.name} <${item.from.address}>`
          : item.from.address,
      ],
      ["subject", item.subject],
      ["body-plain", item.text],
      ["stripped-text", item.text.split("\n\nOn ")[0]],
      ["Message-Id", item.messageId],
      ["attachment-count", String(item.attachments.length)],
      ["timestamp", ts],
      ["token", token],
      ["signature", signature],
    ]
    return {
      headers: [
        [
          "content-type",
          "multipart/form-data; boundary=----lc" + hex(item.id, 16),
        ],
        ["user-agent", "mailgun-routes (phonybox)"],
      ],
      body: fields
        .map(([k, v]) => `${k}: ${v.replace(/\n/g, "\\n")}`)
        .join("\n"),
    }
  }

  return {
    headers: [
      ["content-type", "application/json"],
      ["user-agent", "mailgun/treq-webhooks (phonybox)"],
    ],
    body: json({
      signature: { timestamp: ts, token, signature },
      "event-data": {
        event,
        id: hex(item.id + event, 22),
        timestamp: Number(ts) + 0.218,
        recipient: item.to[0]?.address,
        tags: item.tags,
        message: {
          headers: {
            "message-id": item.messageId.replace(/[<>]/g, ""),
            from: item.from.name
              ? `${item.from.name} <${item.from.address}>`
              : item.from.address,
            to: item.to.map((t) => t.address).join(", "),
            subject: item.subject,
          },
          attachments: item.attachments.map((a) => ({
            filename: a.filename,
            "content-type": a.contentType,
            size: a.size,
          })),
        },
        ...(event === "permanent_fail"
          ? {
              severity: "permanent",
              reason: "bounce",
              "delivery-status": {
                code: 550,
                message:
                  "5.1.1 Mailbox does not exist (fault rule: bounce-billing)",
              },
            }
          : {
              "delivery-status": {
                code: 250,
                message: "OK",
                description: "Captured by phonybox",
              },
            }),
      },
    }),
  }
}

export function buildWebhook(
  adapterId: string,
  event: string,
  item: ChannelItem,
  at: string,
  attempt: number,
  url: string
): Built {
  if (adapterId === "mailgun" && item.channel === "email")
    return mailgun(event, item, at)
  if (adapterId === "telnyx" && item.channel !== "email")
    return telnyx(event, item, at, attempt, url)
  return {
    headers: [["content-type", "application/json"]],
    body: json({ event, id: item.id }),
  }
}
