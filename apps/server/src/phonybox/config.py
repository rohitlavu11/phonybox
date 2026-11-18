from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

Dataset = Literal["empty", "small", "large"]


class Config(BaseModel):
    host: str = "127.0.0.1"
    control_port: int = 4100
    mailgun_port: int = 4101
    telnyx_port: int = 4102
    #: Ports for other adapters by id. Unset: control_port + the adapter's port_offset.
    adapter_ports: dict[str, int] = Field(default_factory=dict)

    #: ":memory:" (default) or a file path for state that survives restarts.
    db_path: str = ":memory:"
    #: Data loaded at start and on POST /api/reset without a dataset.
    dataset: Dataset = "small"
    #: Seed for the load-test generator. Same seed, same data.
    generator_seed: int = 7

    #: Mail or texts to an unknown address create an inbox (created_by="auto").
    #: Off: mail goes to the catch-all and texts/faxes to unknown numbers are still accepted.
    auto_create_inboxes: bool = True

    #: Seconds after the first attempt at which each retry happens. len()+1 attempts in total.
    #: The real schedules span hours; compressed so a test run sees every attempt.
    retry_delays: list[float] = Field(default_factory=lambda: [2.0, 10.0])
    webhook_timeout: float = 10.0

    #: Delays (seconds) between fax lifecycle events: queued, media.processed, sending.started, delivered.
    fax_steps: list[float] = Field(default_factory=lambda: [0.0, 1.0, 2.0, 5.0])
    #: Delay before Mailgun delivered events and Telnyx message.sent/finalized.
    event_delay: float = 0.5

    #: Seed for the Telnyx Ed25519 signing key. Stable by default so TELNYX_PUBLIC_KEY in your
    #: .env keeps working across restarts. Set your own (PHONYBOX_TELNYX_KEY_SEED) wherever
    #: someone other than you can reach Phonybox: anyone who knows the seed can sign webhooks.
    telnyx_key_seed: str = "phonybox/telnyx-signing-key"

    #: Built UI to serve at the control port, if present.
    ui_dist: Path | None = None

    #: Where your app listens for webhooks. Replaces http://localhost:3000 in every adapter's
    #: default webhook URL. In Docker, use http://host.docker.internal:3000 or a service name.
    webhook_base: str = "http://localhost:3000"
    #: Host used in URLs the emulator hands out (media links, paging). Defaults to `host`,
    #: or 127.0.0.1 when binding all interfaces.
    public_host: str | None = None
    #: The one URL people and apps reach Phonybox at, when it runs behind a proxy or on a
    #: platform that serves a single port (Cloud Run, Fly, Render). Every adapter is also
    #: served on the control port under /<adapter id>, so with this set the Mailgun adapter
    #: is {public_url}/mailgun and Telnyx is {public_url}/telnyx, and every URL Phonybox hands
    #: out (media links, paging, MCP get_setup) uses it instead of host and port.
    public_url: str | None = None

    #: When set, the inspector, the control API and /mcp require this token, as
    #: `Authorization: Bearer <token>` or as either half of HTTP Basic credentials (so a browser
    #: can sign in with its own password prompt). /api/health stays open for health checks, and
    #: the adapters keep their providers' own auth (see each adapter's acceptAnyKey and apiKey).
    access_token: str | None = None

    #: Adapter settings to hold fixed, by adapter id then setting key (e.g. {"mailgun":
    #: {"apiKey": "..."}}), applied over the defaults at start and after every reset. From the
    #: environment as PHONYBOX_<ADAPTER>__<SETTING>, e.g. PHONYBOX_MAILGUN__API_KEY.
    adapter_settings: dict[str, dict[str, str]] = Field(default_factory=dict)

    def port_for(self, adapter_id: str, offset: int) -> int:
        named = {"mailgun": self.mailgun_port, "telnyx": self.telnyx_port}.get(adapter_id)
        return self.adapter_ports.get(adapter_id) or named or self.control_port + offset

    @property
    def max_attempts(self) -> int:
        return len(self.retry_delays) + 1

    def base_url(self, port: int) -> str:
        host = self.public_host or ("127.0.0.1" if self.host in ("0.0.0.0", "::") else self.host)
        return f"http://{host}:{port}"

    def webhook_url(self, default: str) -> str:
        """Rebase a default webhook URL onto `webhook_base`."""
        return self.webhook_base.rstrip("/") + default.removeprefix("http://localhost:3000") if default.startswith("http://localhost:3000") else default
