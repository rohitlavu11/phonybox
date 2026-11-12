/**
 * Compile-time contract between the Python server and this UI.
 *
 * schema.gen.ts is generated from contracts/control-api.openapi.json (repo root)
 * (`pnpm contract`). If the server changes a shape the UI depends on, one of
 * these lines stops compiling, in CI, before anything ships.
 *
 *   server -> UI   every response the server can send fits the type the UI reads.
 *   UI -> server   every request body the UI builds is one the server accepts.
 */
import type * as Core from "@/types/domain"
import type { components } from "./schema.gen"
import type * as UI from "./types"
import type { AdapterState } from "./types"

type S = components["schemas"]
type Fits<From, To> = [From] extends [To] ? true : false
type Expect<T extends true> = T

/* ----------------------------------------------------- server -> UI */

export type ServerToUi = [
  Expect<Fits<S["InboxSummary"], UI.InboxSummary>>,
  Expect<Fits<S["InboxPage"], UI.Page<UI.InboxSummary>>>,
  Expect<Fits<S["ChannelStats"], UI.ChannelStats>>,
  Expect<Fits<S["EmailMessage"], Core.EmailMessage>>,
  Expect<Fits<S["SmsMessage"], Core.SmsMessage>>,
  Expect<Fits<S["FaxDocument"], Core.FaxDocument>>,
  Expect<Fits<S["ItemPage"], UI.Page<Core.ChannelItem>>>,
  Expect<Fits<S["Conversation"], UI.Conversation>>,
  Expect<Fits<S["ConversationPage"], UI.Page<UI.Conversation>>>,
  Expect<Fits<S["WebhookDelivery"], Core.WebhookDelivery>>,
  Expect<Fits<S["WebhookPage"], UI.Page<Core.WebhookDelivery>>>,
  Expect<Fits<S["WebhookTarget"], UI.WebhookTarget>>,
  Expect<Fits<S["ApiRequest"], Core.ApiRequest>>,
  Expect<Fits<S["RequestPage"], UI.Page<Core.ApiRequest>>>,
  Expect<Fits<S["AdapterState"], AdapterState>>,
  Expect<Fits<S["Health"]["dataset"], UI.Dataset>>,
]

/* ----------------------------------------------------- UI -> server */

type BulkBody<Op extends S["BulkRequest"]["op"]> = { op: Op } & UI.Selection

export type UiToServer = [
  Expect<Fits<UI.NewInbox, S["NewInbox"]>>,
  Expect<Fits<BulkBody<"delete">, S["BulkRequest"]>>,
  Expect<Fits<{ ids: string[]; read: boolean }, S["SetRead"]>>,
  Expect<Fits<{ to: string; subject: string; text: string }, S["SendToApp"]>>,
  Expect<Fits<{ appNumber: string; body: string }, S["SendToApp"]>>,
  Expect<
    Fits<{ appNumber: string; title: string; pages: number }, S["SendToApp"]>
  >,
  Expect<Fits<Partial<AdapterState>, S["AdapterPatch"]>>,
  Expect<Fits<{ dataset: UI.Dataset }, S["ResetRequest"]>>,
]
