import { defineConfig } from "vitepress"

const repo = "https://github.com/rohitlavu11/phonybox"

export default defineConfig({
  title: "Phonybox",
  description: "Local Mailgun and Telnyx emulators for testing apps and AI agents that send and receive email, SMS and fax.",
  // Served from https://rohitlavu11.github.io/phonybox/
  base: process.env.DOCS_BASE ?? "/phonybox/",
  cleanUrls: true,
  // Links to the running emulator are expected to be "dead" at build time.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  lastUpdated: true,
  appearance: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/phonybox/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#e0602a" }],
    ["meta", { property: "og:title", content: "Phonybox: a stunt double for your comms stack" }],
    ["meta", { property: "og:description", content: "Run Mailgun and Telnyx locally. Real APIs, real signed webhooks, inboxes your agents can read." }],
    ["meta", { property: "og:image", content: "https://rohitlavu11.github.io/phonybox/screenshots/mail-light.png" }],
  ],
  themeConfig: {
    logo: { src: "/logo.svg", alt: "" },
    siteTitle: "phonybox",
    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "Adapters", link: "/adapters/", activeMatch: "/adapters/" },
      { text: "Architecture", link: "/architecture" },
      { text: "Roadmap", link: "/roadmap" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Why Phonybox", link: "/guide/why" },
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Connect your app", link: "/guide/connect-your-app" },
          { text: "Testing AI agents", link: "/guide/testing-agents" },
          { text: "The inspector", link: "/guide/inspector" },
          { text: "Docker & databases", link: "/guide/docker" },
          { text: "Configuration", link: "/guide/configuration" },
        ],
      },
      {
        text: "Adapters",
        items: [
          { text: "Overview", link: "/adapters/" },
          { text: "Mailgun", link: "/adapters/mailgun" },
          { text: "Telnyx", link: "/adapters/telnyx" },
          { text: "Build an adapter", link: "/adapters/build-an-adapter" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Control API", link: "/reference/control-api" },
          { text: "Contracts & testing", link: "/reference/contracts" },
          { text: "Roadmap", link: "/roadmap" },
          { text: "Contributing", link: "/contributing" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    editLink: { pattern: `${repo}/edit/main/apps/docs/:path`, text: "Edit this page" },
    search: { provider: "local" },
    outline: [2, 3],
    footer: { message: "Released under the Apache-2.0 License.", copyright: "Not affiliated with Mailgun or Telnyx." },
  },
})
