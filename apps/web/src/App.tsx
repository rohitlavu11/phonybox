import * as React from "react"
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useLiveUpdates } from "@/api/hooks"
import { channels } from "@/channels/meta"
import { ChannelRoute } from "@/channels/views"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { CommandMenu } from "@/components/layout/command-menu"
import { StatusBar } from "@/components/layout/status-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AdaptersPage } from "@/pages/adapters"
import { AdapterDetailPage } from "@/pages/adapter-detail"
import { AgentsPage } from "@/pages/agents"
import { InboxesPage } from "@/pages/inboxes"
import { RequestsPage } from "@/pages/requests"
import { SettingsPage } from "@/pages/settings"
import { WebhooksPage } from "@/pages/webhooks"

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

function Shell() {
  const [commandOpen, setCommandOpen] = React.useState(false)
  useLiveUpdates()

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCommandOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar onOpenCommand={() => setCommandOpen(true)} />
      <SidebarInset className="min-w-0 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
        <StatusBar />
      </SidebarInset>
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </SidebarProvider>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Navigate to="/mail" replace />} />
              {channels.map((c) => (
                <Route
                  key={c.id}
                  path={`${c.path}/:inboxId?/:itemId?`}
                  element={<ChannelRoute channel={c.id} />}
                />
              ))}
              <Route path="/inboxes" element={<InboxesPage />} />
              <Route path="/webhooks" element={<WebhooksPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/adapters" element={<AdaptersPage />} />
              <Route
                path="/adapters/:adapterId"
                element={<AdapterDetailPage />}
              />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/mail" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
