"""Provider data caching — avoids re-reading all source data on every run.

Each provider's messages are cached to data/cache_<provider>.json with a
watermark (latest timestamp_ms). On next run, only messages newer than
the watermark are fetched from the provider, then merged with the cache.
"""

import json
import os
from dataclasses import asdict

from providers.base import TokenMessage, ProviderResult

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(TOOL_DIR, "data")


def _cache_path(provider_name: str) -> str:
    return os.path.join(CACHE_DIR, f"cache_{provider_name}.json")


def _msg_to_dict(msg: TokenMessage) -> dict:
    return asdict(msg)


def _dict_to_msg(d: dict) -> TokenMessage:
    return TokenMessage(**d)


def load_cache(provider_name: str) -> tuple[list[TokenMessage], int, int]:
    """Load cached messages. Returns (messages, watermark_ms, cached_sessions)."""
    path = _cache_path(provider_name)
    if not os.path.exists(path):
        return [], 0, 0
    try:
        with open(path) as f:
            data = json.load(f)
        msgs = [_dict_to_msg(d) for d in data.get("messages", [])]
        return msgs, data.get("watermark_ms", 0), data.get("sessions", 0)
    except Exception:
        return [], 0, 0


def save_cache(provider_name: str, messages: list[TokenMessage], sessions: int):
    """Save messages to cache with watermark."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    watermark = max((m.timestamp_ms for m in messages), default=0)
    data = {
        "watermark_ms": watermark,
        "sessions": sessions,
        "message_count": len(messages),
        "messages": [_msg_to_dict(m) for m in messages],
    }
    with open(_cache_path(provider_name), "w") as f:
        json.dump(data, f)


def cached_load(load_fn, provider_name: str) -> ProviderResult:
    """Wrapper: load from cache + fetch only new data from provider.

    For providers where incremental loading is hard (stats-cache synthetic
    messages, cursor vscdb), we use a simpler dedup strategy based on
    message fingerprints.
    """
    cached_msgs, watermark_ms, cached_sessions = load_cache(provider_name)

    # Always call the provider to get fresh data
    result = load_fn()

    if not cached_msgs:
        # No cache — save everything
        save_cache(provider_name, result.messages, result.sessions)
        return result

    # Build fingerprint set from cached messages for dedup
    cached_fps = set()
    for m in cached_msgs:
        cached_fps.add(_fingerprint(m))

    # Find new messages not in cache
    new_msgs = []
    for m in result.messages:
        if _fingerprint(m) not in cached_fps:
            new_msgs.append(m)

    # Merge: cached + new
    merged = cached_msgs + new_msgs
    merged_sessions = max(result.sessions, cached_sessions)

    save_cache(provider_name, merged, merged_sessions)

    return ProviderResult(
        name=result.name,
        messages=merged,
        sessions=merged_sessions,
        source=result.source + "+cached",
    )


def _fingerprint(m: TokenMessage) -> tuple:
    """Create a dedup fingerprint for a message."""
    return (
        m.provider, m.model, m.input_tokens, m.output_tokens,
        m.timestamp_ms, m.session_id,
    )
