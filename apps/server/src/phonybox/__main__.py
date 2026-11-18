"""phonybox CLI.

  phonybox                          serve with the small demo seed
  phonybox --seed large             ~3,500 inboxes for load testing the UI
  phonybox --seed empty --db .phonybox/state.db
  phonybox openapi > ../../contracts/control-api.openapi.json

Every flag can also be set with an environment variable (PHONYBOX_<FLAG>),
which is how the Docker image is configured.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections.abc import Mapping
from pathlib import Path

from . import __version__
from .config import Config


def _find_ui() -> Path | None:
    """The built web app: $PHONYBOX_UI (set in the Docker image), else apps/web/dist in a checkout."""
    if env := os.environ.get("PHONYBOX_UI"):
        return Path(env)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "apps" / "web" / "dist"
        if (candidate / "index.html").exists():
            return candidate
    return None


def _env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(f"PHONYBOX_{name}", default)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="phonybox",
        description="Local Mailgun and Telnyx emulators with an inspector UI, for testing apps and agents that send email, SMS and fax.",
        epilog="Each flag can be set with PHONYBOX_<FLAG> (e.g. PHONYBOX_SEED=empty, PHONYBOX_WEBHOOK_BASE=http://host.docker.internal:3000). "
        "Environment only: PHONYBOX_ACCESS_TOKEN (require a token for the UI, control API and MCP), "
        "PHONYBOX_TELNYX_KEY_SEED (your own Telnyx signing key) and PHONYBOX_<ADAPTER>__<SETTING> "
        "(hold an adapter setting fixed, e.g. PHONYBOX_MAILGUN__API_KEY).",
    )
    p.add_argument(
        "command",
        nargs="?",
        default="serve",
        choices=["serve", "mcp", "openapi"],
        help="serve (default): run Phonybox. mcp: MCP server over stdio for clients that launch a command, "
        "using the Phonybox at --url (every Phonybox also serves MCP over HTTP at /mcp). "
        "openapi: print the control API's OpenAPI document.",
    )
    p.add_argument("--url", default=_env("URL", "http://localhost:4100"), help="With `mcp`: the running Phonybox to use.")
    p.add_argument("--host", default=_env("HOST", "127.0.0.1"), help="Interface to bind (0.0.0.0 in Docker).")
    p.add_argument("--port", type=int, default=int(_env("PORT", "4100") or 4100), help="UI + control API. Mailgun and Telnyx use the next two ports.")
    p.add_argument("--mailgun-port", type=int, default=_int(_env("MAILGUN_PORT")))
    p.add_argument("--telnyx-port", type=int, default=_int(_env("TELNYX_PORT")))
    p.add_argument("--db", default=_env("DB", ":memory:"), help="SQLite file or postgresql:// URL to keep state across restarts (default: in memory).")
    p.add_argument("--seed", choices=["empty", "small", "large"], default=_env("SEED", "small"), help="Data loaded at start and on reset.")
    p.add_argument("--webhook-base", default=_env("WEBHOOK_BASE", "http://localhost:3000"), help="Where your app receives webhooks.")
    p.add_argument("--public-host", default=_env("PUBLIC_HOST"), help="Host to use in URLs phonybox hands out (media, paging).")
    p.add_argument(
        "--public-url",
        default=_env("PUBLIC_URL"),
        help="The one URL Phonybox is reached at behind a proxy or on a single-port platform (adapters at <url>/<adapter id>).",
    )
    p.add_argument("--no-auto-inboxes", action="store_true", default=_env("AUTO_INBOXES", "1") == "0", help="Send mail for unknown addresses to the catch-all instead of creating inboxes.")
    p.add_argument("--ui", type=Path, help="Built web app directory (default: auto-detected).")
    p.add_argument("--version", action="version", version=__version__)
    args = p.parse_args(argv)

    # Secrets come only from the environment, never a flag that `ps` would show.
    access_token = _env("ACCESS_TOKEN") or None

    if args.command == "mcp":  # stdout is the protocol: print nothing else
        from .mcp_server import run_stdio

        run_stdio(args.url, access_token)
        return

    from .adapters import REGISTRY

    cfg = Config(
        host=args.host,
        control_port=args.port,
        mailgun_port=args.mailgun_port or args.port + 1,
        telnyx_port=args.telnyx_port or args.port + 2,
        db_path=args.db,
        dataset=args.seed,
        auto_create_inboxes=not args.no_auto_inboxes,
        webhook_base=args.webhook_base,
        public_host=args.public_host,
        public_url=args.public_url,
        access_token=access_token,
        adapter_settings=adapter_settings_from_env(os.environ, list(REGISTRY)),
        ui_dist=args.ui or _find_ui(),
    )
    if seed := _env("TELNYX_KEY_SEED"):
        cfg.telnyx_key_seed = seed

    from .emulator import Emulator

    if args.command == "openapi":
        emu = Emulator(cfg.model_copy(update={"dataset": "empty"}))
        json.dump(emu.control.openapi(), sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return

    if cfg.db_path != ":memory:" and "://" not in cfg.db_path:  # a SQLite file, not a database URL
        Path(cfg.db_path).parent.mkdir(parents=True, exist_ok=True)
    emu = Emulator(cfg)
    print(f"phonybox {__version__}", flush=True)
    print(f"  UI + control API  {emu.url('control')}{'' if cfg.ui_dist else '  (web app not built: pnpm build)'}")
    for spec in REGISTRY.values():
        print(f"  {spec.name:<17} {emu.url(spec.id)}{spec.base_path}")
    print(f"  MCP (for agents)  {emu.url('control')}/mcp")
    print(f"  Access            {'token required (PHONYBOX_ACCESS_TOKEN)' if cfg.access_token else 'open: anyone who can reach the port'}")
    print(f"  Webhooks to       {cfg.webhook_base}")
    print(f"  Telnyx public key {emu.signer.public_key_b64}")
    print(f"  Seed              {cfg.dataset}{'' if cfg.db_path == ':memory:' else f'  (db: {_redact(cfg.db_path)})'}", flush=True)
    asyncio.run(emu.serve())


def _redact(url: str) -> str:
    """Hide the password in a database URL before printing it."""
    import re

    return re.sub(r"(://[^:/@]+:)[^@]+@", r"\1***@", url)


def _int(value: str | None) -> int | None:
    return int(value) if value else None


def adapter_settings_from_env(environ: Mapping[str, str], adapter_ids: list[str]) -> dict[str, dict[str, str]]:
    """PHONYBOX_<ADAPTER>__<SETTING> as {adapter id: {settingKey: value}}: PHONYBOX_MAILGUN__API_KEY is
    mailgun's apiKey. The double underscore keeps settings apart from flags such as PHONYBOX_TELNYX_PORT.
    The emulator checks each key against the adapter's settings, so a typo stops startup instead of being ignored."""
    out: dict[str, dict[str, str]] = {}
    for adapter_id in adapter_ids:
        prefix = f"PHONYBOX_{adapter_id.upper()}__"
        for name, value in environ.items():
            if name.startswith(prefix):
                head, *rest = name.removeprefix(prefix).lower().split("_")
                out.setdefault(adapter_id, {})[head + "".join(w.title() for w in rest)] = value
    return out


if __name__ == "__main__":
    main()
