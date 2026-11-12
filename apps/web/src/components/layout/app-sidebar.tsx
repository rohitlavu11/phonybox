import * as React from "react"
import { Link, NavLink, useLocation } from "react-router"
import {
  BlocksIcon,
  BotIcon,
  LayersIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  ScrollTextIcon,
  SettingsIcon,
  SunIcon,
  WebhookIcon,
} from "lucide-react"
import {
  useAdapterStates,
  useChannelStats,
  useFailingCount,
  usePinned,
} from "@/api/hooks"
import type { ChannelId } from "@/types/domain"
import { channels, getChannel } from "@/channels/meta"
import { UnreadBadge, formatCount } from "@/channels/inbox-pane"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"
import { NewInboxDialog } from "../new-inbox-dialog"

const PINNED_LIMIT = 8

/**
 * Fixed-size navigation: it shows channel totals and the few inboxes you
 * pinned, never the full inbox list. Browsing thousands of inboxes happens in
 * each channel's inbox column and on /inboxes.
 */
export function AppSidebar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const { pathname } = useLocation()
  const stats = useChannelStats().data ?? []
  const pinned = usePinned().data ?? []
  const failing = useFailingCount().data ?? 0
  const adapterStates = useAdapterStates()
  const totalInboxes = stats.reduce((n, s) => n + s.inboxes, 0)
  // `n` is bumped per open so the dialog remounts with empty fields.
  const [newInbox, setNewInbox] = React.useState<{
    channel: ChannelId
    n: number
    open: boolean
  }>({ channel: "email", n: 0, open: false })

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 px-3 pt-3.5 pb-2">
        <div className="flex items-center justify-between">
          <Wordmark />
          <button
            type="button"
            onClick={onOpenCommand}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Open command menu"
          >
            <Kbd>⌘K</Kbd>
          </button>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span className="relative flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-ok/60 motion-reduce:hidden" />
            <span className="relative size-1.5 rounded-full bg-ok" />
          </span>
          127.0.0.1:4100
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup className="py-1.5">
          <SidebarGroupLabel className="text-[11px] tracking-wide uppercase">
            Channels
          </SidebarGroupLabel>
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarGroupAction
                onClick={() =>
                  setNewInbox((d) => ({
                    channel: "email",
                    n: d.n + 1,
                    open: true,
                  }))
                }
              >
                <PlusIcon />
                <span className="sr-only">New inbox</span>
              </SidebarGroupAction>
            </TooltipTrigger>
            <TooltipContent side="right">New inbox</TooltipContent>
          </Tooltip>
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {channels.map((c) => {
                const s = stats.find((x) => x.channel === c.id)
                return (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(c.path)}
                    >
                      <NavLink to={c.path}>
                        <c.icon className="text-muted-foreground" />
                        <span>{c.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                    <SidebarMenuBadge className="gap-2">
                      {s?.unread ? (
                        <UnreadBadge n={s.unread} />
                      ) : (
                        <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                          {formatCount(s?.inboxes ?? 0)}
                        </span>
                      )}
                    </SidebarMenuBadge>
                  </SidebarMenuItem>
                )
              })}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/inboxes")}
                >
                  <NavLink to="/inboxes">
                    <LayersIcon className="text-muted-foreground" />
                    <span>All inboxes</span>
                  </NavLink>
                </SidebarMenuButton>
                <SidebarMenuBadge className="text-[11px] font-normal text-muted-foreground tabular-nums">
                  {formatCount(totalInboxes)}
                </SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="py-1.5">
          <SidebarGroupLabel className="text-[11px] tracking-wide uppercase">
            Pinned
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {pinned.length ? (
              <SidebarMenu className="gap-px">
                {pinned.slice(0, PINNED_LIMIT).map((inbox) => {
                  const meta = getChannel(inbox.channel)
                  const to = `${meta.path}/${inbox.id}`
                  return (
                    <SidebarMenuItem key={inbox.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={
                          pathname === to || pathname.startsWith(to + "/")
                        }
                        className="h-auto py-1.5"
                      >
                        <NavLink to={to}>
                          <meta.icon className="mt-0.5 size-3.5! self-start text-muted-foreground" />
                          <span className="flex min-w-0 flex-col gap-px">
                            <span
                              className={cn(
                                "truncate",
                                inbox.unreadCount > 0 &&
                                  "font-medium text-foreground"
                              )}
                            >
                              {inbox.label ?? meta.formatAddress(inbox.address)}
                            </span>
                            <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                              {inbox.catchAll
                                ? "any other address"
                                : meta.formatAddress(inbox.address)}
                            </span>
                          </span>
                        </NavLink>
                      </SidebarMenuButton>
                      {inbox.unreadCount > 0 ? (
                        <SidebarMenuBadge className="top-1/2! -translate-y-1/2">
                          <UnreadBadge n={inbox.unreadCount} />
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  )
                })}
                {pinned.length > PINNED_LIMIT ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      size="sm"
                      className="text-muted-foreground"
                    >
                      <Link to="/inboxes?filter=pinned">
                        {pinned.length - PINNED_LIMIT} more pinned
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            ) : (
              <p className="px-2 py-1 text-[11px] leading-relaxed text-muted-foreground">
                Pin the inboxes you check often. They show up here.
              </p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-1 border-t border-sidebar-border pt-2.5">
          <SidebarGroupLabel className="text-[11px] tracking-wide uppercase">
            Inspect
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              <NavItem to="/webhooks" icon={WebhookIcon} label="Webhooks">
                {failing > 0 ? (
                  <SidebarMenuBadge className="text-[11px] text-destructive! tabular-nums">
                    {formatCount(failing)} failing
                  </SidebarMenuBadge>
                ) : null}
              </NavItem>
              <NavItem to="/requests" icon={ScrollTextIcon} label="API log" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="pt-1">
          <SidebarGroupLabel className="text-[11px] tracking-wide uppercase">
            Configure
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              <NavItem to="/adapters" icon={BlocksIcon} label="Adapters">
                <SidebarMenuBadge className="text-[11px] text-muted-foreground tabular-nums">
                  {Object.values(adapterStates).filter((a) => a.enabled).length}
                </SidebarMenuBadge>
              </NavItem>
              <NavItem to="/agents" icon={BotIcon} label="Agent access" />
              <NavItem to="/settings" icon={SettingsIcon} label="Settings" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-muted-foreground">
            v0.1.0
          </span>
          <ThemeSwitch />
        </div>
      </SidebarFooter>
      <SidebarRail />

      <NewInboxDialog
        key={newInbox.n}
        channel={newInbox.channel}
        open={newInbox.open}
        onOpenChange={(o) => setNewInbox((d) => ({ ...d, open: o }))}
      />
    </Sidebar>
  )
}

function NavItem({
  to,
  icon: Icon,
  label,
  children,
}: {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  children?: React.ReactNode
}) {
  const { pathname } = useLocation()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={pathname.startsWith(to)}>
        <NavLink to={to}>
          <Icon className="text-muted-foreground" />
          <span>{label}</span>
        </NavLink>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
  )
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2 select-none">
      <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
        <rect x="2" y="3" width="19" height="19" rx="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform="translate(5.2 6.2) scale(0.6)"
          d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
        />
        <circle cx="20" cy="4" r="3.3" className="fill-signal" stroke="var(--sidebar)" strokeWidth="1.4" />
      </svg>
      <span className="font-mono text-[13px] font-medium tracking-tight">phonybox</span>
    </span>
  )
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={theme}
      onValueChange={(v) => v && setTheme(v as typeof theme)}
      className="rounded-md border bg-background p-px"
      aria-label="Theme"
    >
      <ToggleGroupItem
        value="light"
        aria-label="Light"
        className="h-5 w-6 min-w-0 px-0"
      >
        <SunIcon className="size-3" />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="dark"
        aria-label="Dark"
        className="h-5 w-6 min-w-0 px-0"
      >
        <MoonIcon className="size-3" />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="system"
        aria-label="System"
        className="h-5 w-6 min-w-0 px-0"
      >
        <MonitorIcon className="size-3" />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
