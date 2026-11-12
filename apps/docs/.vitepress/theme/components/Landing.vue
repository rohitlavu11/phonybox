<script setup lang="ts">
import { ref } from "vue"
import { withBase } from "vitepress"

const install = "docker run -p 4100-4102:4100-4102 ghcr.io/rohitlavu11/phonybox"
const copied = ref(false)
function copy() {
  navigator.clipboard?.writeText(install)
  copied.value = true
  setTimeout(() => (copied.value = false), 1400)
}

const gallery = [
  { name: "sms", title: "SMS threads", text: "Texts from your app, replies from the inbox, STOP handling, and the webhook your handler choked on." },
  { name: "fax", title: "Fax, page by page", text: "Telnyx fax lifecycle from queued to delivered, with real PDF media your app can download." },
  { name: "inboxes", title: "Thousands of inboxes", text: "One inbox per agent run. Search by tag, select everything matching, clean up in one action." },
  { name: "webhooks", title: "Every webhook, signed", text: "Each attempt, status and body. Replay one, or copy it as cURL to debug your handler." },
]
</script>

<template>
  <div class="landing">
    <section class="hero">
      <div class="copy">
        <p class="eyebrow"><span class="dot" />Open source &middot; Apache-2.0 &middot; Mailgun + Telnyx</p>
        <h1>Phony numbers.<br />Real webhooks.</h1>
        <p class="lede">
          Phonybox runs Mailgun and Telnyx on your machine. Your app keeps using the SDKs it ships with, every email,
          text and fax lands in an inbox your agents can read, and replies come back as signed webhooks.
        </p>
        <div class="actions">
          <a class="btn primary" :href="withBase('/guide/getting-started')">Get started</a>
          <a class="btn" href="https://github.com/rohitlavu11/phonybox">GitHub</a>
        </div>
        <button class="install" type="button" @click="copy" :aria-label="`Copy: ${install}`">
          <span class="prompt">$</span>
          <code>{{ install }}</code>
          <span class="copied">{{ copied ? "copied" : "copy" }}</span>
        </button>
      </div>
      <figure class="hero-shot">
        <img class="only-light" :src="withBase('/screenshots/mail-light.png')" alt="The Phonybox inspector showing a verification email with its code extracted" width="1440" height="900" />
        <img class="only-dark" :src="withBase('/screenshots/mail-dark.png')" alt="" width="1440" height="900" />
      </figure>
    </section>

    <section class="steps">
      <div class="step">
        <span class="n">01</span>
        <h3>Point your SDK at it</h3>
        <p>Change one base URL. Mailgun on <code>:4101</code>, Telnyx on <code>:4102</code>. Any key works.</p>
        <pre><code><span class="c"># .env.test</span>
MAILGUN_URL=http://localhost:4101
TELNYX_BASE_URL=http://localhost:4102/v2</code></pre>
      </div>
      <div class="step">
        <span class="n">02</span>
        <h3>Let the agent work</h3>
        <p>Give each run its own inbox, then wait for the message and take the code out of it. Or <a :href="withBase('/guide/mcp')">let Claude do it</a> over MCP.</p>
        <pre><code>POST /api/inboxes  <span class="c">{"channel":"sms"}</span>
GET  /api/inboxes/+14155550100/wait
<span class="c">→ {"extract":{"codes":["731604"]}}</span></code></pre>
      </div>
      <div class="step">
        <span class="n">03</span>
        <h3>Get real webhooks back</h3>
        <p>Replies, delivery receipts and fax events arrive at your app, signed the way the provider signs them.</p>
        <pre><code>POST /webhooks/telnyx/messaging
telnyx-signature-ed25519: rxUmN3KQ…
<span class="c">{"data":{"event_type":"message.received"…</span></code></pre>
      </div>
    </section>

    <section class="why">
      <h2>Built for testing agents that pick up the phone</h2>
      <div class="grid">
        <div>
          <h3>The real API surface</h3>
          <p>Mailgun messages, events, routes and bounces. Telnyx messaging and fax. Official SDKs run against it in CI every night.</p>
        </div>
        <div>
          <h3>Failure on purpose</h3>
          <p>Bounced mail, STOP opt-outs, busy fax lines, carrier errors. And your own handler returning 500, retried on the provider's schedule.</p>
        </div>
        <div>
          <h3>Claude can run the test</h3>
          <p>An <a :href="withBase('/guide/mcp')">MCP server</a> gives Claude Code inboxes, waits, codes, links and replies as tools. Or script it over HTTP: an inbox per run, tagged, deleted by tag when you're done.</p>
        </div>
        <div>
          <h3>Deterministic when you need it</h3>
          <p>Frozen clock, seeded IDs, identical bytes run to run. The contract suite proves it against SQLite and PostgreSQL.</p>
        </div>
        <div>
          <h3>Scales past toy size</h3>
          <p>Thousands of inboxes, paged and indexed on the server, virtualized in the UI. Load-test seed included.</p>
        </div>
        <div>
          <h3>Runs anywhere</h3>
          <p>One Docker image, or <code>uv run phonybox</code>. SQLite in memory by default, PostgreSQL when you want state to stick.</p>
        </div>
      </div>
    </section>

    <section class="gallery">
      <figure v-for="g in gallery" :key="g.name">
        <img :src="withBase(`/screenshots/${g.name}-light.png`)" :alt="g.title" loading="lazy" width="1440" height="900" />
        <figcaption>
          <strong>{{ g.title }}</strong>
          <span>{{ g.text }}</span>
        </figcaption>
      </figure>
    </section>

    <section class="providers">
      <div>
        <h2>Providers</h2>
        <p>Each provider is an adapter: its API routes plus the webhooks it sends. Adding one is a single Python module and a manifest.</p>
        <a class="btn" :href="withBase('/adapters/build-an-adapter')">Build an adapter</a>
      </div>
      <ul>
        <li><span class="live">live</span><strong>Mailgun</strong><span>email · routes · events</span></li>
        <li><span class="live">live</span><strong>Telnyx</strong><span>SMS · MMS · fax</span></li>
        <li><span>planned</span><strong>Telnyx Voice</strong><span>calls for voice agents</span></li>
        <li><span>planned</span><strong>Twilio</strong><span>SMS · voice</span></li>
        <li><span>planned</span><strong>SendGrid · Postmark · Resend · SES</strong><span>email</span></li>
        <li><span>planned</span><strong>SMTP</strong><span>any app that speaks SMTP</span></li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.landing {
  max-width: 1200px;
  margin: 0 auto;
  padding: 48px 24px 96px;
}
h1 {
  font-size: clamp(40px, 6vw, 64px);
  line-height: 1.02;
  letter-spacing: -0.035em;
  font-weight: 600;
  margin: 18px 0 20px;
}
h2 {
  font-size: 28px;
  letter-spacing: -0.02em;
  font-weight: 600;
  margin: 0 0 24px;
  border: 0;
  padding: 0;
}
h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 6px;
}
p {
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin: 0;
}
code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.88em;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 48px;
  align-items: center;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--pb-signal);
}
.lede {
  font-size: 17px;
  max-width: 34em;
}
.actions {
  display: flex;
  gap: 10px;
  margin: 28px 0 16px;
}
.btn {
  display: inline-flex;
  align-items: center;
  height: 38px;
  padding: 0 16px;
  border-radius: 7px;
  border: 1px solid var(--vp-c-border);
  font-weight: 500;
  font-size: 14px;
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: background-color 0.15s;
}
.btn:hover {
  background: var(--vp-c-bg-soft);
}
.btn.primary {
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
  border-color: transparent;
}
.btn.primary:hover {
  background: var(--vp-button-brand-hover-bg);
}
.install {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 520px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.install code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vp-c-text-1);
}
.prompt,
.copied {
  color: var(--vp-c-text-3);
  font-size: 12px;
}
.hero-shot {
  margin: 0;
}
.hero-shot img {
  width: 100%;
  height: auto;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04), 0 30px 60px -30px rgba(0, 0, 0, 0.35);
}
.only-dark {
  display: none;
}
:global(.dark) .only-light {
  display: none;
}
:global(.dark) .only-dark {
  display: block;
}

.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 88px;
  border-top: 1px solid var(--vp-c-divider);
}
.step {
  padding: 28px 28px 0 0;
}
.step + .step {
  padding-left: 28px;
  border-left: 1px solid var(--vp-c-divider);
}
.n {
  display: block;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--pb-signal);
  margin-bottom: 10px;
}
.step p {
  font-size: 14px;
  min-height: 3.2em;
}
.step p a,
.why p a {
  color: var(--vp-c-text-1);
  text-decoration: underline;
  text-decoration-color: var(--pb-signal);
  text-underline-offset: 3px;
  transition: color 0.15s;
}
.step p a:hover,
.why p a:hover {
  color: var(--pb-signal);
}
.step pre {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--vp-code-block-bg);
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
}
.step pre code {
  font-size: 12px;
  color: var(--vp-c-text-1);
}
.c {
  color: var(--vp-c-text-3);
}

.why {
  margin-top: 96px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 32px 40px;
}
.grid p {
  font-size: 14px;
}

.gallery {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 32px;
  margin-top: 96px;
}
.gallery figure {
  margin: 0;
}
.gallery img {
  width: 100%;
  height: auto;
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
}
.gallery figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 12px;
  font-size: 14px;
}
.gallery figcaption span {
  color: var(--vp-c-text-2);
}

.providers {
  display: grid;
  grid-template-columns: minmax(0, 4fr) minmax(0, 6fr);
  gap: 48px;
  margin-top: 96px;
  padding-top: 40px;
  border-top: 1px solid var(--vp-c-divider);
}
.providers p {
  margin-bottom: 20px;
  font-size: 15px;
}
.providers ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.providers li {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  align-items: baseline;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 14px;
}
.providers li span:first-child {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-3);
}
.providers li span.live {
  color: var(--pb-ok);
}
.providers li span:last-child {
  color: var(--vp-c-text-2);
  font-size: 13px;
}

@media (max-width: 960px) {
  .hero,
  .providers {
    grid-template-columns: 1fr;
  }
  .steps,
  .grid {
    grid-template-columns: 1fr;
  }
  .step,
  .step + .step {
    padding: 24px 0 0;
    border-left: 0;
  }
  .gallery {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .providers li {
    grid-template-columns: 56px 1fr;
  }
  .providers li span:last-child {
    grid-column: 2;
  }
}
</style>
