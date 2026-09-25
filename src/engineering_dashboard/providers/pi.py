"""Pi coding-agent provider — reads Pi-format JSONL session files."""

import glob
import json
import os
from datetime import datetime

from .base import ProviderResult, TokenMessage, TranscriptTurn

PROVIDER_NAME = "pi"


def _session_dir() -> str:
    direct = os.environ.get("PI_CODING_AGENT_SESSION_DIR")
    if direct:
        return os.path.expanduser(direct)
    base = os.environ.get("PI_CODING_AGENT_DIR")
    if base:
        return os.path.join(os.path.expanduser(base), "sessions")
    return os.path.expanduser("~/.pi/agent/sessions")


def _to_ms(value) -> int:
    if isinstance(value, bool) or value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value if value > 10_000_000_000 else value * 1000)
    if isinstance(value, str) and value.strip():
        try:
            if value.strip().isdigit():
                return _to_ms(int(value.strip()))
            return int(datetime.fromisoformat(value.strip().replace("Z", "+00:00")).timestamp() * 1000)
        except (ValueError, OverflowError):
            return 0
    return 0


def _as_int(value) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def _as_float(value) -> float:
    if isinstance(value, bool):
        return 0.0
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block["text"] for block in content
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str)
        )
    return ""


def load_from_session_dir(session_dir: str, provider_name: str) -> ProviderResult:
    messages: list[TokenMessage] = []
    transcripts: dict[str, list[TranscriptTurn]] = {}
    session_ids: set[str] = set()

    for path in sorted(glob.glob(os.path.join(session_dir, "**", "*.jsonl"), recursive=True)):
        header = {}
        seen_entries: set[str] = set()
        try:
            with open(path, encoding="utf-8") as session_file:
                for line in session_file:
                    try:
                        entry = json.loads(line)
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if not isinstance(entry, dict):
                        continue
                    if entry.get("type") == "session":
                        header = entry
                        continue
                    if entry.get("type") != "message":
                        continue
                    entry_id = entry.get("id")
                    if isinstance(entry_id, str):
                        if entry_id in seen_entries:
                            continue
                        seen_entries.add(entry_id)
                    message = entry.get("message")
                    if not isinstance(message, dict):
                        continue
                    role = message.get("role")
                    if role not in ("user", "assistant"):
                        continue

                    session_id = str(header.get("id") or os.path.splitext(os.path.basename(path))[0])
                    timestamp_ms = _to_ms(entry.get("timestamp") or message.get("timestamp"))
                    model = str(message.get("model") or "")
                    if role == "assistant":
                        usage = message.get("usage")
                        if isinstance(usage, dict):
                            input_tokens = _as_int(usage.get("input", usage.get("inputTokens", usage.get("input_tokens", 0))))
                            output_tokens = _as_int(usage.get("output", usage.get("outputTokens", usage.get("output_tokens", 0))))
                            cache_read = _as_int(usage.get("cacheRead", usage.get("cache_read", 0)))
                            cache_write = _as_int(usage.get("cacheWrite", usage.get("cache_write", 0)))
                            cost_data = usage.get("cost")
                            cost = _as_float(cost_data.get("total")) if isinstance(cost_data, dict) else _as_float(cost_data)
                            if input_tokens or output_tokens or cache_read or cache_write or cost:
                                messages.append(TokenMessage(
                                    provider=provider_name,
                                    model=model or "unknown",
                                    input_tokens=input_tokens,
                                    output_tokens=output_tokens,
                                    reasoning_tokens=_as_int(usage.get("reasoning", usage.get("reasoning_tokens", 0))),
                                    cache_read_tokens=cache_read,
                                    cache_write_tokens=cache_write,
                                    cost=cost,
                                    timestamp_ms=timestamp_ms,
                                    session_id=session_id,
                                    project=str(header.get("cwd") or ""),
                                ))
                                session_ids.add(session_id)
                    transcripts.setdefault(session_id, []).append(TranscriptTurn(
                        role=role,
                        text=_text(message.get("content")),
                        timestamp_ms=timestamp_ms,
                        model=model,
                    ))
        except OSError:
            continue

    transcripts = {sid: turns for sid, turns in transcripts.items() if turns}
    return ProviderResult(
        name=provider_name,
        messages=messages,
        session_transcripts=transcripts,
        sessions=len(session_ids),
        source="jsonl",
    )


def load() -> ProviderResult:
    return load_from_session_dir(_session_dir(), PROVIDER_NAME)
