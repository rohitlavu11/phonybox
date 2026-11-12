"""Control-API models: the contract between the server and the UI (and agents).

Field names serialize as camelCase to match apps/web/src/types/domain.ts and
apps/web/src/api/types.ts. `Opt[...]` fields are omitted from JSON when unset
and appear as optional (not nullable) in the OpenAPI schema, which is what the
UI types expect (`label?: string`). Fields that are genuinely nullable in the UI
(`lastActivityAt`, webhook `status`, `nextCursor`) stay `X | None`.

The OpenAPI document generated from these models is snapshotted in
contracts/control-api.openapi.json and type-checked against the UI nightly.
"""

from __future__ import annotations

from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from pydantic.json_schema import SkipJsonSchema

T = TypeVar("T")

ChannelId = Literal["email", "sms", "fax"]
Direction = Literal["outbound", "inbound"]
DeliveryStatus = Literal["queued", "sending", "delivered", "failed", "bounced", "received"]
CreatedBy = Literal["seed", "ui", "agent", "auto"]
InboxSort = Literal["activity", "unread", "name", "created"]
InboxFilter = Literal["all", "unread", "pinned", "failing", "idle"]
HttpMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE"]


def _absent(v: Any) -> bool:
    return v is None


OptStr = Annotated[str | SkipJsonSchema[None], Field(default=None, exclude_if=_absent)]
OptInt = Annotated[int | SkipJsonSchema[None], Field(default=None, exclude_if=_absent)]


class Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        # Responses always include defaulted fields, so the schema says so; request
        # schemas keep them optional. FastAPI emits separate Input/Output schemas.
        json_schema_serialization_defaults_required=True,
    )


# ----------------------------------------------------------------------- inboxes


class Inbox(Model):
    id: str
    channel: ChannelId
    address: str
    label: OptStr
    adapter_id: str
    catch_all: bool = False
    tags: list[str] = Field(default_factory=list)
    pinned: bool = False
    created_by: CreatedBy
    created_at: str


class InboxSummary(Inbox):
    message_count: int
    unread_count: int
    last_activity_at: str | None
    failing: int


class NewInbox(Model):
    channel: ChannelId
    #: Omit to get a generated address (agent-<hex>@inbox.test, or a free 555-01xx number).
    address: OptStr
    label: OptStr
    #: Defaults to the first adapter serving the channel.
    adapter_id: OptStr
    tags: list[str] = Field(default_factory=list)


class InboxQuery(Model):
    channel: ChannelId | SkipJsonSchema[None] = Field(default=None, exclude_if=_absent)
    q: OptStr
    filter: InboxFilter = "all"
    sort: InboxSort = "activity"


class BulkRequest(Model):
    op: Literal["delete", "clear", "read", "pin", "unpin"]
    #: Either explicit ids...
    ids: list[str] | SkipJsonSchema[None] = Field(default=None, exclude_if=_absent)
    #: ...or everything matching a query, minus `except`.
    query: InboxQuery | SkipJsonSchema[None] = Field(default=None, exclude_if=_absent)
    except_: list[str] = Field(default_factory=list, alias="except")


class BulkResult(Model):
    affected: int


class ChannelStats(Model):
    channel: ChannelId
    inboxes: int
    unread: int
    items: int


# ------------------------------------------------------------------------- items


class Address(Model):
    name: OptStr
    address: str


class Attachment(Model):
    filename: str
    content_type: str
    size: int


class EmailMessage(Model):
    id: str
    channel: Literal["email"]
    inbox_id: str
    adapter_id: str
    direction: Direction
    message_id: str
    from_: Address = Field(alias="from")
    to: list[Address]
    cc: list[Address] | SkipJsonSchema[None] = Field(default=None, exclude_if=_absent)
    subject: str
    text: str
    #: Only on GET /api/items/:id.
    html: OptStr
    attachments: list[Attachment]
    #: Empty in list responses; filled on GET /api/items/:id.
    headers: list[tuple[str, str]]
    tags: list[str]
    status: DeliveryStatus
    read: bool
    created_at: str


class SmsMessage(Model):
    id: str
    channel: Literal["sms"]
    inbox_id: str
    adapter_id: str
    direction: Direction
    provider_id: str
    app_number: str
    peer_number: str
    body: str
    media: list[Attachment]
    parts: int
    status: DeliveryStatus
    read: bool
    created_at: str
    note: OptStr


class FaxEvent(Model):
    event: str
    at: str


class FaxDocument(Model):
    id: str
    channel: Literal["fax"]
    inbox_id: str
    adapter_id: str
    direction: Direction
    provider_id: str
    app_number: str
    peer_number: str
    title: str
    pages: int
    quality: Literal["normal", "high", "very_high"]
    status: DeliveryStatus
    failure_reason: OptStr
    events: list[FaxEvent]
    read: bool
    created_at: str


Item = Annotated[EmailMessage | SmsMessage | FaxDocument, Field(discriminator="channel")]


class Conversation(Model):
    key: str
    inbox_id: str
    inbox_address: str
    inbox_label: OptStr
    app_number: str
    last: SmsMessage
    count: int
    unread: int


class SetRead(Model):
    ids: list[str]
    read: bool


class SendToApp(Model):
    """Body for POST /api/inboxes/:id/send. Fields used depend on the inbox's channel."""

    # email
    to: OptStr
    subject: OptStr
    text: OptStr
    html: OptStr
    # sms and fax
    app_number: OptStr
    body: OptStr
    # fax
    title: OptStr
    pages: OptInt


class Extracted(Model):
    codes: list[str]
    links: list[str]


class WaitResult(Model):
    item: Item
    extract: Extracted


# -------------------------------------------------------------------------- logs


class WebhookDelivery(Model):
    id: str
    adapter_id: str
    channel: ChannelId
    event: str
    url: str
    #: None when the connection failed before a response.
    status: int | None
    duration_ms: int
    attempt: int
    max_attempts: int
    created_at: str
    related_id: OptStr
    #: Empty in list responses; filled on GET /api/webhooks/:id.
    request_headers: list[tuple[str, str]]
    request_body: str
    response_body: OptStr
    error: OptStr


class WebhookTarget(Model):
    url: str
    adapter_id: str
    total: int
    failed: int
    last_status: int | None


class ApiRequest(Model):
    id: str
    adapter_id: str
    method: HttpMethod
    path: str
    status: int
    duration_ms: int
    created_at: str
    related_id: OptStr
    request_body: OptStr
    response_body: OptStr


class Count(Model):
    count: int


# ---------------------------------------------------------------------- adapters


class AdapterState(Model):
    enabled: bool
    values: dict[str, str | bool]


class AdapterPatch(Model):
    enabled: bool | SkipJsonSchema[None] = Field(default=None, exclude_if=_absent)
    values: dict[str, str | bool] | SkipJsonSchema[None] = Field(default=None, exclude_if=_absent)


class ResetRequest(Model):
    dataset: Literal["empty", "small", "large"] | SkipJsonSchema[None] = Field(default=None, exclude_if=_absent)


class Health(Model):
    ok: bool
    version: str
    dataset: Literal["empty", "small", "large"]
    ports: dict[str, int]


# -------------------------------------------------------------------------- page


class Page(Model, Generic[T]):
    items: list[T]
    #: Rows matching the query across all pages.
    total: int
    #: Pass as `cursor` for the next page; null at the end.
    next_cursor: int | None


# Named pages keep schema names readable in the OpenAPI contract and generated TS.
class InboxPage(Page[InboxSummary]):
    pass


class ItemPage(Page[Item]):  # type: ignore[valid-type]
    pass


class ConversationPage(Page[Conversation]):
    pass


class WebhookPage(Page[WebhookDelivery]):
    pass


class RequestPage(Page[ApiRequest]):
    pass
