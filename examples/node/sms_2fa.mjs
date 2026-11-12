#!/usr/bin/env node
// SMS two-factor auth and opt-out, run the way an agent test would run it. No dependencies (Node 18+).
//
//     node examples/node/sms_2fa.mjs
//
// 1. Creates an SMS inbox (a free 555-01xx number) for this run.
// 2. Plays your app: texts a one-time code through the Telnyx API.
//    (Plain fetch here; your app would use the telnyx SDK.)
// 3. Waits for the text and extracts the code, as an agent would.
// 4. The user texts STOP. Phonybox POSTs a signed message.received webhook to your app;
//    a small receiver on :3000 stands in for your app and verifies the Ed25519 signature.
// 5. Your app texts again, and Telnyx (Phonybox) refuses delivery with error 40300.
// 6. Deletes every inbox from this run.
//
// Env: PHONYBOX_URL (default http://localhost:4100), TELNYX_URL (default: same host,
// Telnyx port from /api/health, plus /v2), WEBHOOK_PORT (default 3000).
// If something already listens on WEBHOOK_PORT, the receiver is skipped and the
// script reads the webhook delivery log instead.

import crypto from "node:crypto"
import http from "node:http"

const PHONYBOX = (process.env.PHONYBOX_URL ?? "http://localhost:4100").replace(/\/$/, "")
const API = `${PHONYBOX}/api`
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT ?? 3000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

// --- a stand-in for your app's webhook handler -------------------------------------

const received = []

function startReceiver() {
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      received.push({ path: req.url, headers: req.headers, raw: Buffer.concat(chunks).toString("utf8") })
      res.writeHead(200).end()
    })
  })
  return new Promise((resolve) => {
    server.once("error", () => resolve(null)) // port taken: fall back to the delivery log
    server.listen(WEBHOOK_PORT, "127.0.0.1", () => resolve(server))
  })
}

// Exactly the check from Telnyx's docs: Ed25519 over `${timestamp}|${raw body}`.
// Your production handler does the same, with the account's public key.
function telnyxSignatureOk(publicKeyB64, { headers, raw }) {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyB64, "base64")])
  const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" })
  const signed = Buffer.from(`${headers["telnyx-timestamp"]}|${raw}`)
  return crypto.verify(null, signed, key, Buffer.from(headers["telnyx-signature-ed25519"], "base64"))
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value || Date.now() > deadline) return value
    await sleep(250)
  }
}

// --- the test -------------------------------------------------------------------------

const health = await call("GET", `${API}/health`)
const telnyx = process.env.TELNYX_URL ?? `http://${new URL(PHONYBOX).hostname}:${health.ports.telnyx}/v2`
const settings = (await call("GET", `${API}/adapters`)).telnyx.values
const appNumber = settings.appNumbers.split(",")[0].trim()
const run = `example-${crypto.randomBytes(3).toString("hex")}`
const receiver = await startReceiver()
const auth = { authorization: "Bearer any-key-works" }

// 1. A number of its own, so parallel runs never read each other's texts.
const inbox = await call("POST", `${API}/inboxes`, { channel: "sms", label: "sms 2fa example", tags: [`run:${run}`] })
const phone = inbox.address
const box = encodeURIComponent(phone)
console.log(`1. inbox        ${phone}  (tag run:${run})`)

// 2. Your app texts a code.
const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
await call("POST", `${telnyx}/messages`, { from: appNumber, to: phone, text: `Acme: your code is ${code}. It expires in 10 minutes.` }, auth)
console.log(`2. app sent     a code from ${appNumber} via Telnyx`)

// 3. The agent waits for it and takes the code.
const got = await call("GET", `${API}/inboxes/${box}/wait?timeout=10`)
console.log(`3. agent read   code ${got.extract.codes[0]}`)
if (got.extract.codes[0] !== code) throw new Error(`expected ${code}, got ${got.extract.codes}`)

// 4. The user texts STOP. Your app receives Telnyx's message.received webhook.
const stop = await call("POST", `${API}/inboxes/${box}/send`, { appNumber, body: "STOP" })
console.log("4. user texted  STOP; Phonybox POSTs message.received to your app")
if (receiver) {
  const hook = await waitFor(() => received.find((h) => JSON.parse(h.raw).data?.event_type === "message.received"))
  if (hook) {
    const { payload } = JSON.parse(hook.raw).data
    const ok = telnyxSignatureOk(settings.publicKey, hook)
    console.log(`   your app got  "${payload.text}" from ${payload.from.phone_number}, signature ${ok ? "valid" : "INVALID"}`)
    if (!ok) throw new Error("signature did not verify")
  }
} else {
  const deliveries = await waitFor(async () => {
    const list = await call("GET", `${API}/items/${stop.id}/webhooks`)
    return list.length ? list : null
  }, 15_000)
  const last = deliveries?.at(-1)
  console.log(`   delivery log  ${last ? `${last.url} -> ${last.status ? `HTTP ${last.status}` : last.error}` : "no attempt yet; see Webhooks in the inspector"}`)
}

// 5. Your app texts again. Like Telnyx, Phonybox accepts the request, then fails delivery.
const again = await call("POST", `${telnyx}/messages`, { from: appNumber, to: phone, text: "Acme: one more thing..." }, auth)
const final = await waitFor(async () => {
  const { data } = await call("GET", `${telnyx}/messages/${again.data.id}`, undefined, auth)
  return data.to[0].status === "delivery_failed" || data.to[0].status === "delivered" ? data : null
})
console.log(`5. app texted   again -> ${final?.to[0].status ?? "still sending"}${final?.errors?.length ? `, error ${final.errors[0].code} (${final.errors[0].title})` : ""}`)

// 6. Clean up everything this run created.
await call("POST", `${API}/inboxes/bulk`, { op: "delete", query: { q: `tag:run:${run}` }, except: [] })
console.log(`6. cleaned up   inboxes tagged run:${run}`)

receiver?.close()
