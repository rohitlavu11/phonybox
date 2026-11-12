import * as React from "react"
import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function PageHeader({
  title,
  meta,
  children,
  className,
}: {
  title: React.ReactNode
  meta?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b px-3",
        className
      )}
    >
      <SidebarTrigger className="-ml-0.5 text-muted-foreground" />
      <Separator orientation="vertical" className="mr-1 h-4! self-center!" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="truncate text-[13px] font-medium">{title}</h1>
        {meta ? (
          <div className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">
            {meta}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-1.5">{children}</div>
      ) : null}
    </header>
  )
}
