"""Adapter registry. To add a provider, write `adapters/<name>.py` exporting
`ADAPTER = AdapterSpec(...)` and add it to the tuple below."""

from __future__ import annotations

from . import mailgun, telnyx
from .base import AdapterSpec

REGISTRY: dict[str, AdapterSpec] = {spec.id: spec for spec in (mailgun.ADAPTER, telnyx.ADAPTER)}


def get(adapter_id: str) -> AdapterSpec:
    return REGISTRY[adapter_id]


def for_channel(channel: str) -> AdapterSpec:
    """The default adapter for a channel: the first registered one that serves it."""
    return next(spec for spec in REGISTRY.values() if channel in spec.channels)


__all__ = ["REGISTRY", "AdapterSpec", "for_channel", "get"]
