"""Identifier and token generation.

`Ids(seed=None)` is random (production). `Ids(seed=n)` derives every value from
a counter and the seed, so two runs with the same seed produce the same ids,
tokens and message-ids in the same order.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid as _uuid


class Ids:
    def __init__(self, seed: int | None = None) -> None:
        self.seed = seed
        self._n = 0

    def _bytes(self, size: int) -> bytes:
        if self.seed is None:
            return secrets.token_bytes(size)
        out = b""
        while len(out) < size:
            self._n += 1
            out += hashlib.sha256(f"{self.seed}:{self._n}".encode()).digest()
        return out[:size]

    def hex(self, length: int = 16) -> str:
        return self._bytes((length + 1) // 2).hex()[:length]

    def uuid(self) -> str:
        return str(_uuid.UUID(bytes=self._bytes(16), version=4))

    def short(self, prefix: str) -> str:
        """Readable internal ids: em-3f9a21c0."""
        return f"{prefix}-{self.hex(8)}"
