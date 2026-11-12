import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/utils"

/**
 * Fixed-row-height virtual list with infinite loading. Only the rows in view
 * (plus overscan) are in the DOM, so 50 or 50,000 rows cost the same.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  getKey,
  renderRow,
  hasMore = false,
  loading = false,
  onLoadMore,
  activeIndex,
  className,
  label,
  empty,
  header,
}: {
  items: T[]
  rowHeight: number
  getKey: (item: T) => string
  renderRow: (item: T, index: number) => React.ReactNode
  hasMore?: boolean
  /** First page still loading: show nothing rather than the empty state. */
  loading?: boolean
  onLoadMore?: () => void
  /** Kept in view, e.g. when moving with j/k. */
  activeIndex?: number
  className?: string
  label?: string
  empty?: React.ReactNode
  /** Rendered above the rows inside the scroller (sticky table headers). */
  header?: React.ReactNode
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const count = items.length + (hasMore ? 1 : 0)

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns fresh functions by design
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    getItemKey: (i) => (i < items.length ? getKey(items[i]) : "__more"),
  })

  const rows = virtualizer.getVirtualItems()
  const lastIndex = rows.length ? rows[rows.length - 1].index : -1

  React.useEffect(() => {
    if (hasMore && lastIndex >= items.length - 20) onLoadMore?.()
  }, [hasMore, lastIndex, items.length, onLoadMore])

  React.useEffect(() => {
    if (activeIndex !== undefined && activeIndex >= 0)
      virtualizer.scrollToIndex(activeIndex, { align: "auto" })
  }, [activeIndex, virtualizer])

  return (
    <div
      ref={scrollRef}
      className={cn("min-h-0 overflow-y-auto overscroll-contain", className)}
      aria-label={label}
    >
      {header}
      {items.length === 0 && !hasMore ? (
        loading ? null : (
          empty
        )
      ) : (
        <div
          style={{ height: virtualizer.getTotalSize() }}
          className="relative w-full"
        >
          {rows.map((row) => (
            <div
              key={row.key}
              className="absolute top-0 left-0 w-full"
              style={{
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
            >
              {row.index < items.length ? (
                renderRow(items[row.index], row.index)
              ) : (
                <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                  Loading more…
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
