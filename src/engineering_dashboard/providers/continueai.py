"""Continue provider — reads session JSON from ~/.continue/sessions."""

import glob
import json
import os
from datetime import datetime

from .base import TokenMessage, ProviderResult, TranscriptTurn

PROVIDER_NAME = "continue"
SESSIONS_GLOB = os.path.expanduser("~/.continue/sessions/*.json")


def _to_ms(value) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        # Assume ms if very large, seconds otherwise
        return int(value if value > 10_000_000_000 else value * 1000)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return 0
        try:
            if s.isdigit():
                n = int(s)
                return n if n > 10_000_000_000 else n * 1000
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except Exception:
            return 0
    return 0


def _get_int(d: dict, *keys: str) -> int:
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)):
            return int(v)
    return 0


def _extract_tokens(item: dict, msg: dict) -> tuple[int, int, int, int, int]:
    # Continue schemas vary by version; check several likely locations/field names.
    cand = [
        msg.get("tokens") if isinstance(msg.get("tokens"), dict) else {},
        item.get("tokens") if isinstance(item.get("tokens"), dict) else {},
        item.get("usage") if isinstance(item.get("usage"), dict) else {},
        msg.get("usage") if isinstance(msg.get("usage"), dict) else {},
    ]
    for t in cand:
        if not t:
            continue
        inp = _get_int(t, "input", "input_tokens", "prompt_tokens")
        out = _get_int(t, "output", "output_tokens", "completion_tokens")
        reasoning = _get_int(t, "reasoning", "reasoning_tokens", "reasoning_output_tokens")
        cache_read = _get_int(t, "cache_read", "cached_input_tokens", "cache_read_input_tokens")
        cache_write = _get_int(t, "cache_write", "cache_creation_input_tokens")
        if inp or out or reasoning or cache_read or cache_write:
            return inp, out, reasoning, cache_read, cache_write
    return 0, 0, 0, 0, 0


def _extract_text(value) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str) and item.strip():
                parts.append(item.strip())
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return "\n\n".join(parts)
    return ""


def load() -> ProviderResult:
    files = [f for f in glob.glob(SESSIONS_GLOB) if os.path.basename(f) != "sessions.json"]
    if not files:
        return ProviderResult(name=PROVIDER_NAME, source="not found")

    messages = []
    session_transcripts = {}
    session_ids = set()

    for filepath in files:
        try:
            with open(filepath) as f:
                data = json.load(f)
        except Exception:
            continue

        history = data.get("history", [])
        if not isinstance(history, list):
            continue

        sid = data.get("sessionId") or os.path.splitext(os.path.basename(filepath))[0]
        project = data.get("workspaceDirectory", "")
        session_ids.add(sid)

        for item in history:
            if not isinstance(item, dict):
                continue
            msg = item.get("message", {})
            if not isinstance(msg, dict):
                continue
            role = msg.get("role")
            text = _extract_text(msg.get("content") or msg.get("text") or msg.get("parts"))
            ts_ms = _to_ms(item.get("timestamp") or msg.get("timestamp") or item.get("createdAt"))
            model = msg.get("model") or item.get("model") or "continue-assistant"

            if role in ("user", "assistant", "system") and text:
                session_transcripts.setdefault(sid, []).append(TranscriptTurn(
                    role=role,
                    text=text,
                    timestamp_ms=ts_ms,
                    model=model if role == "assistant" else "",
                ))

            if role != "assistant":
                continue

            inp, out, reasoning, cache_read, cache_write = _extract_tokens(item, msg)

            messages.append(TokenMessage(
                provider=PROVIDER_NAME,
                model=model,
                input_tokens=inp,
                output_tokens=out,
                reasoning_tokens=reasoning,
                cache_read_tokens=cache_read,
                cache_write_tokens=cache_write,
                cost=float(item.get("cost") or msg.get("cost") or 0.0),
                timestamp_ms=ts_ms,
                session_id=sid,
                project=project,
            ))

    return ProviderResult(
        name=PROVIDER_NAME,
        messages=messages,
        session_transcripts={
            session_id: sorted(turns, key=lambda turn: (turn.timestamp_ms, turn.role != "user"))
            for session_id, turns in session_transcripts.items()
        },
        sessions=len(session_ids),
        source="json",
    )
