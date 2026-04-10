"""Gemini CLI provider — reads sessions from ~/.gemini/tmp/*/chats/session-*.json."""

import glob
import json
import os
from datetime import datetime

from .base import TokenMessage, ProviderResult, TranscriptTurn

PROVIDER_NAME = "gemini"


def _candidate_roots() -> list[str]:
    home = os.path.expanduser("~")
    return [
        os.path.join(home, ".gemini"),
        os.path.join(home, "gemini"),
        os.path.join(home, ".config", "gemini"),
    ]


def _session_files() -> list[str]:
    files = []
    for root in _candidate_roots():
        if not os.path.exists(root):
            continue
        files.extend(glob.glob(os.path.join(root, "tmp", "*", "chats", "session-*.json")))
    return sorted(set(files))


def _to_ms(value) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
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


def _extract_tokens(msg: dict) -> tuple[int, int, int, int, int]:
    t = msg.get("tokens") if isinstance(msg.get("tokens"), dict) else {}
    if not t:
        return 0, 0, 0, 0, 0

    inp = int(t.get("input", t.get("input_tokens", t.get("prompt_tokens", 0))) or 0)
    out = int(t.get("output", t.get("output_tokens", t.get("completion_tokens", 0))) or 0)
    reasoning = int(t.get("reasoning", t.get("reasoning_tokens", 0)) or 0)
    cache_read = int(t.get("cache_read", t.get("cached_input_tokens", 0)) or 0)
    cache_write = int(t.get("cache_write", t.get("cache_creation_input_tokens", 0)) or 0)
    return inp, out, reasoning, cache_read, cache_write


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
    files = _session_files()
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

        sid = data.get("sessionId") or os.path.splitext(os.path.basename(filepath))[0]
        project = data.get("projectHash", "")
        session_ids.add(sid)

        for msg in data.get("messages", []):
            if not isinstance(msg, dict):
                continue
            role = msg.get("type")
            transcript_role = "assistant" if role in ("gemini", "assistant") else "user" if role in ("user", "human") else ""
            text = _extract_text(msg.get("content") or msg.get("text") or msg.get("parts"))
            ts_ms = _to_ms(msg.get("timestamp"))
            model = msg.get("model") or "gemini-cli"

            if transcript_role and text:
                session_transcripts.setdefault(sid, []).append(TranscriptTurn(
                    role=transcript_role,
                    text=text,
                    timestamp_ms=ts_ms,
                    model=model if transcript_role == "assistant" else "",
                ))

            if role != "gemini":
                continue

            inp, out, reasoning, cache_read, cache_write = _extract_tokens(msg)

            messages.append(TokenMessage(
                provider=PROVIDER_NAME,
                model=model,
                input_tokens=inp,
                output_tokens=out,
                reasoning_tokens=reasoning,
                cache_read_tokens=cache_read,
                cache_write_tokens=cache_write,
                cost=0.0,
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
