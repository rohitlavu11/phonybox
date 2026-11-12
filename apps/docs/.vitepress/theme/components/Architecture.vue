<template>
  <figure class="arch">
    <svg viewBox="0 0 960 440" role="img" aria-labelledby="arch-title arch-desc">
      <title id="arch-title">Phonybox architecture</title>
      <desc id="arch-desc">
        Your app calls the Mailgun and Telnyx adapters through its normal SDKs. Adapters write to one store (SQLite or PostgreSQL).
        A scheduler sends signed webhooks back to your app. The control API serves the web inspector and agents.
      </desc>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" class="head" />
        </marker>
        <marker id="arrow-signal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" class="head-signal" />
        </marker>
      </defs>

      <!-- your app -->
      <g>
        <rect x="16" y="150" width="190" height="120" rx="10" class="box app" />
        <text x="111" y="196" class="title">Your app</text>
        <text x="111" y="218" class="sub">unchanged SDKs</text>
        <text x="111" y="238" class="mono">mailgun.js · telnyx</text>
      </g>

      <!-- adapters -->
      <g>
        <rect x="300" y="64" width="200" height="96" rx="10" class="box" />
        <text x="400" y="100" class="title">Mailgun adapter</text>
        <text x="400" y="122" class="mono">:4101 /v3/…</text>
        <text x="400" y="142" class="sub">HMAC-signed webhooks</text>
      </g>
      <g>
        <rect x="300" y="260" width="200" height="96" rx="10" class="box" />
        <text x="400" y="296" class="title">Telnyx adapter</text>
        <text x="400" y="318" class="mono">:4102 /v2/…</text>
        <text x="400" y="338" class="sub">Ed25519-signed webhooks</text>
      </g>

      <!-- store -->
      <g>
        <rect x="580" y="160" width="170" height="100" rx="10" class="box store" />
        <text x="665" y="196" class="title">Store</text>
        <text x="665" y="218" class="sub">inboxes · items · logs</text>
        <text x="665" y="238" class="mono">SQLite | PostgreSQL</text>
      </g>

      <!-- scheduler -->
      <g>
        <rect x="580" y="330" width="170" height="80" rx="10" class="box" />
        <text x="665" y="362" class="title">Scheduler</text>
        <text x="665" y="384" class="sub">retries · fax lifecycle</text>
      </g>

      <!-- control api + clients -->
      <g>
        <rect x="810" y="160" width="134" height="100" rx="10" class="box" />
        <text x="877" y="196" class="title">Control API</text>
        <text x="877" y="218" class="mono">:4100 /api</text>
        <text x="877" y="238" class="sub">REST · SSE</text>
      </g>
      <g>
        <rect x="810" y="40" width="134" height="64" rx="10" class="box client" />
        <text x="877" y="68" class="title">Inspector</text>
        <text x="877" y="88" class="sub">web UI</text>
      </g>
      <g>
        <rect x="810" y="316" width="134" height="64" rx="10" class="box client" />
        <text x="877" y="344" class="title">Agents</text>
        <text x="877" y="364" class="sub">tests · MCP (soon)</text>
      </g>

      <!-- app -> adapters -->
      <path d="M206 186 C 250 186, 250 112, 296 112" class="edge" marker-end="url(#arrow)" />
      <path d="M206 234 C 250 234, 250 308, 296 308" class="edge" marker-end="url(#arrow)" />
      <text x="232" y="146" class="label">API calls</text>

      <!-- adapters -> store -->
      <path d="M500 112 C 540 112, 540 192, 576 192" class="edge" marker-end="url(#arrow)" />
      <path d="M500 308 C 540 308, 540 228, 576 228" class="edge" marker-end="url(#arrow)" />

      <!-- store <-> control api -->
      <path d="M750 210 L 806 210" class="edge" marker-start="url(#arrow)" marker-end="url(#arrow)" />
      <!-- control api -> inspector / agents -->
      <path d="M877 160 L 877 108" class="edge" marker-end="url(#arrow)" />
      <path d="M877 260 L 877 312" class="edge" marker-start="url(#arrow)" />

      <!-- store -> scheduler -->
      <path d="M665 260 L 665 326" class="edge" marker-end="url(#arrow)" />

      <!-- scheduler -> app : signed webhooks -->
      <path d="M580 392 C 300 430, 120 420, 111 274" class="edge signal" marker-end="url(#arrow-signal)" />
      <text x="300" y="424" class="label signal-text">signed webhooks: message.received, delivered, fax.delivered…</text>
    </svg>
  </figure>
</template>

<style scoped>
.arch {
  margin: 24px 0 32px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-alt);
}
svg {
  display: block;
  width: 100%;
  height: auto;
}
.box {
  fill: var(--vp-c-bg);
  stroke: var(--vp-c-border);
  stroke-width: 1.2;
}
.box.store {
  stroke: var(--vp-c-text-2);
}
.box.app {
  stroke: var(--pb-signal);
  stroke-width: 1.6;
}
.box.client {
  fill: var(--vp-c-bg-soft);
}
text {
  text-anchor: middle;
  fill: var(--vp-c-text-1);
  font-family: var(--vp-font-family-base);
}
.title {
  font-size: 15px;
  font-weight: 600;
}
.sub {
  font-size: 12px;
  fill: var(--vp-c-text-2);
}
.mono {
  font-size: 11.5px;
  fill: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
}
.label {
  font-size: 11.5px;
  fill: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}
.edge {
  fill: none;
  stroke: var(--vp-c-text-3);
  stroke-width: 1.4;
}
.edge.signal {
  stroke: var(--pb-signal);
  stroke-dasharray: 5 4;
}
.signal-text {
  fill: var(--pb-signal);
}
.head {
  fill: var(--vp-c-text-3);
}
.head-signal {
  fill: var(--pb-signal);
}
</style>
