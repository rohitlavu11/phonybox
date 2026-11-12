import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The Python server owns :4100 (control API + built UI). In development Vite
// serves the UI on :5173 and proxies /api, including the SSE stream, to it.
const server = process.env.PHONYBOX_URL ?? "http://127.0.0.1:4100"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: server, changeOrigin: false } },
  },
})
