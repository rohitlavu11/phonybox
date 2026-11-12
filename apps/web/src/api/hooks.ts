/**
 * React Query hooks over the control API.
 *
 * - Lists are infinite queries: one page at a time, next page fetched as the
 *   virtualized list nears the end.
 * - Nothing polls. The server's change feed invalidates the topics that
 *   changed (useLiveUpdates), and only mounted queries refetch.
 * - With the in-memory transport, queries are seeded synchronously so there is
 *   no loading flash. Drop `memory()` when the HTTP transport lands.
 */
import * as React from "react"
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { api, isMemory } from "./client"
import { getDb } from "@/mocks/db"
import type {
  ConversationQuery,
  InboxQuery,
  ItemQuery,
  Page,
  RequestQuery,
  WebhookQuery,
} from "./types"

const MEMORY_TRANSPORT = isMemory

function memory<T>(peek: () => T) {
  return MEMORY_TRANSPORT ? { initialData: peek, staleTime: Infinity } : {}
}

function useList<T, Q extends object>(
  key: string[],
  query: Q,
  fetch: (q: Q & { cursor: number }) => Promise<Page<T>>,
  peek: (q: Q & { cursor: number }) => Page<T>,
  enabled = true
) {
  const result = useInfiniteQuery({
    queryKey: [...key, query],
    queryFn: ({ pageParam }) => fetch({ ...query, cursor: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
    ...(MEMORY_TRANSPORT
      ? {
          initialData: () => ({
            pages: [peek({ ...query, cursor: 0 })],
            pageParams: [0],
          }),
          staleTime: Infinity,
        }
      : {}),
  })
  const items = React.useMemo(
    () => result.data?.pages.flatMap((p) => p.items) ?? [],
    [result.data]
  )
  return {
    items,
    total: result.data?.pages[0]?.total ?? 0,
    hasMore: Boolean(result.hasNextPage),
    loadMore: () => {
      if (result.hasNextPage && !result.isFetchingNextPage)
        void result.fetchNextPage()
    },
    isLoading: result.isLoading,
  }
}

/* ---------------------------------------------------------------- inboxes */

export const useInboxes = (q: Omit<InboxQuery, "cursor">) =>
  useList(["inboxes", "list"], q, api.listInboxes, (x) =>
    getDb().listInboxes(x)
  )

export const useInbox = (id: string | undefined) =>
  useQuery({
    queryKey: ["inboxes", "one", id],
    queryFn: () => api.getInbox(id!),
    enabled: Boolean(id),
    ...memory(() => (id ? getDb().getInbox(id) : null)),
  })

export const usePinned = () =>
  useQuery({
    queryKey: ["inboxes", "pinned"],
    queryFn: api.pinned,
    ...memory(() => getDb().pinned()),
  })

export const useChannelStats = () =>
  useQuery({
    queryKey: ["inboxes", "stats"],
    queryFn: api.channelStats,
    ...memory(() => getDb().channelStats()),
  })

/* ------------------------------------------------------------------ items */

export const useItems = (q: Omit<ItemQuery, "cursor">) =>
  useList(["items", "list"], q, api.listItems, (x) => getDb().listItems(x))

export const useItem = (id: string | undefined) =>
  useQuery({
    queryKey: ["items", "one", id],
    queryFn: () => api.getItem(id!),
    enabled: Boolean(id),
    ...memory(() => (id ? getDb().getItem(id) : null)),
  })

export const useConversations = (q: Omit<ConversationQuery, "cursor">) =>
  useList(["items", "conversations"], q, api.listConversations, (x) =>
    getDb().listConversations(x)
  )

export const useThread = (inboxId: string, appNumber: string) =>
  useQuery({
    queryKey: ["items", "thread", inboxId, appNumber],
    queryFn: () => api.thread(inboxId, appNumber),
    ...memory(() => getDb().thread(inboxId, appNumber)),
  })

/* ------------------------------------------------------------------- logs */

export const useWebhooks = (q: Omit<WebhookQuery, "cursor">) =>
  useList(["webhooks", "list"], q, api.listWebhooks, (x) =>
    getDb().listWebhooks(x)
  )

export const useWebhook = (id: string | null) =>
  useQuery({
    queryKey: ["webhooks", "one", id],
    queryFn: () => api.getWebhook(id!),
    enabled: Boolean(id),
    ...memory(() => (id ? getDb().getWebhook(id) : null)),
  })

export const useWebhooksFor = (itemId: string) =>
  useQuery({
    queryKey: ["webhooks", "for", itemId],
    enabled: Boolean(itemId),
    queryFn: () => api.webhooksFor(itemId),
    ...memory(() => getDb().webhooksFor(itemId)),
  })

export const useWebhookTargets = () =>
  useQuery({
    queryKey: ["webhooks", "targets"],
    queryFn: api.webhookTargets,
    ...memory(() => getDb().webhookTargets()),
  })

export const useLatestWebhook = () =>
  useQuery({
    queryKey: ["webhooks", "latest"],
    queryFn: api.latestWebhook,
    ...memory(() => getDb().latestWebhook()),
  })

export const useFailingCount = () =>
  useQuery({
    queryKey: ["webhooks", "failing"],
    queryFn: api.failingCount,
    ...memory(() => getDb().failingCount()),
  })

export const useRequests = (q: Omit<RequestQuery, "cursor">) =>
  useList(["requests", "list"], q, api.listRequests, (x) =>
    getDb().listRequests(x)
  )

export const useRequest = (id: string | null) =>
  useQuery({
    queryKey: ["requests", "one", id],
    queryFn: () => api.getRequest(id!),
    enabled: Boolean(id),
    ...memory(() => (id ? getDb().getRequest(id) : null)),
  })

export const useRequestFor = (itemId: string) =>
  useQuery({
    queryKey: ["requests", "for", itemId],
    enabled: Boolean(itemId),
    queryFn: () => api.requestFor(itemId),
    ...memory(() => getDb().requestFor(itemId)),
  })

/* --------------------------------------------------------------- adapters */

export const useAdapterStates = () =>
  useQuery({
    queryKey: ["adapters"],
    queryFn: api.adapters,
    ...memory(() => getDb().getAdapters()),
  }).data ?? {}

/* ------------------------------------------------------------ live feed */

/**
 * Subscribe once at the root. Over HTTP this is the server's SSE feed
 * (/api/events); with the mock it's the in-memory DB's change listener.
 */
export function useLiveUpdates() {
  const qc = useQueryClient()
  React.useEffect(() => {
    const invalidate = (topics: Iterable<string>) => {
      for (const topic of topics)
        void qc.invalidateQueries({ queryKey: [topic] })
    }
    if (isMemory) return getDb().subscribe(invalidate)
    const source = new EventSource("/api/events")
    source.addEventListener("change", (e) =>
      invalidate(
        JSON.parse((e as MessageEvent<string>).data).topics as string[]
      )
    )
    // After a reconnect, anything may have changed while we were away.
    source.addEventListener("hello", () =>
      invalidate(["inboxes", "items", "webhooks", "requests", "adapters"])
    )
    return () => source.close()
  }, [qc])
}

export const useDataset = () =>
  useQuery({ queryKey: ["adapters", "dataset"], queryFn: api.dataset })
