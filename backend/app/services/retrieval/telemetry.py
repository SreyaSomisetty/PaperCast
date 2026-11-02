"""Structured log events and per-process counters (spec: Logging, Counters).

Passage text is never logged. Query text appears only at DEBUG, truncated; at
INFO a query is identified by a short hash.
"""
from __future__ import annotations

import hashlib
import json
import logging
from collections import Counter
from datetime import datetime, timezone

_log = logging.getLogger("papercast.retrieval")

counters: Counter[str] = Counter()


def emit(level: int, event: str, **fields: object) -> None:
    """Write one JSON log line for `event`."""
    if not _log.isEnabledFor(level):
        return
    line = {
        "ts": utc_now(),
        "level": logging.getLevelName(level),
        "event": event,
        **fields,
    }
    _log.log(level, json.dumps(line, default=str))


def query_hash(query: str) -> str:
    return hashlib.sha256(query.encode()).hexdigest()[:8]


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
