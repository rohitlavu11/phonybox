import DefaultTheme from "vitepress/theme"
import type { Theme } from "vitepress"
import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "./style.css"
import Landing from "./components/Landing.vue"
import Architecture from "./components/Architecture.vue"
import Shot from "./components/Shot.vue"

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Landing", Landing)
    app.component("Architecture", Architecture)
    app.component("Shot", Shot)
  },
} satisfies Theme
