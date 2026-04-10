"""Trae provider — extracts assistant messages from JSONL/SQLite stores."""

import glob
import json
import os
import sqlite3
from datetime import datetime

from .base import TokenMessage, ProviderResult

PROVIDER_NAME = "trae"


def _roots() -> list[str]:
    home = os.path.expanduser("~")
    return [
        os.path.join(home, ".trae"),
        os.path.join(home, "Library", "Application Support", "Trae"),
        os.path.join(home, ".config", "trae"),
        os.path.join(home, ".local", "share", "trae"),
    ]


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


def _as_int(v) -> int:
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str) and v.isdigit():
        return int(v)
    return 0


def _from_event(obj: dict, sid: str, project: str) -> TokenMessage | None:
    # JSONL event style
    t = obj.get("type")
    p = obj.get("payload", obj)
    if not isinstance(p, dict):
        p = {}

    is_assistant = t in ("assistant", "agent", "agent_message") or p.get("type") in ("assistant", "agent_message")
    if not is_assistant:
        return None

    token_obj = p.get("tokenCount") if isinstance(p.get("tokenCount"), dict) else p.get("tokens") if isinstance(p.get("tokens"), dict) else {}
    inp = _as_int(token_obj.get("inputTokens") if isinstance(token_obj, dict) else 0)
    out = _as_int(token_obj.get("outputTokens") if isinstance(token_obj, dict) else 0)
    if isinstance(token_obj, dict) and not inp and not out:
        inp = _as_int(token_obj.get("input") or token_obj.get("input_tokens") or token_obj.get("prompt_tokens"))
        out = _as_int(token_obj.get("output") or token_obj.get("output_tokens") or token_obj.get("completion_tokens"))

    model = p.get("model") or p.get("modelId") or obj.get("model") or "trae-assistant"
    ts_ms = _to_ms(obj.get("timestamp") or p.get("timestamp") or p.get("createdAt"))

    return TokenMessage(
        provider=PROVIDER_NAME,
        model=model,
        input_tokens=inp,
        output_tokens=out,
        reasoning_tokens=0,
        cache_read_tokens=0,
        cache_write_tokens=0,
        cost=0.0,
        timestamp_ms=ts_ms,
        session_id=sid,
        project=project,
    )


def _load_jsonl(path: str, messages: list[TokenMessage], session_ids: set[str]):
    sid = os.path.splitext(os.path.basename(path))[0]
    project = os.path.dirname(path)
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                msg = _from_event(obj, sid, project)
                if msg:
                    messages.append(msg)
                    session_ids.add(sid)
    except Exception:
        return


def _table_exists(conn, table: str) -> bool:
    try:
        row = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
        return bool(row)
    except Exception:
        return False


def _load_sqlite(path: str, messages: list[TokenMessage], session_ids: set[str]):
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except Exception:
        return

    for table in ("ItemTable", "cursorDiskKV"):
        if not _table_exists(conn, table):
            continue
        try:
            rows = conn.execute(
                f"SELECT key, value FROM {table} WHERE key LIKE '%chat%' OR key LIKE '%conversation%' OR key LIKE '%agent%' OR key LIKE 'composerData:%' OR key LIKE 'bubbleId:%'"
            ).fetchall()
        except Exception:
            continue

        for key, value in rows:
            if value is None:
                continue
            try:
                obj = json.loads(value)
            except Exception:
                continue

            sid = key.split(":")[1] if ":" in key else key
            for container_key in ("conversation", "messages", "bubbles"):
                rows2 = obj.get(container_key)
                if not isinstance(rows2, list):
                    continue
                for row in rows2:
                    if not isinstance(row, dict):
                        continue
                    role = row.get("role")
                    bubble_type = row.get("type")
                    if role != "assistant" and bubble_type not in (2, "assistant"):
                        continue
                    tc = row.get("tokenCount") if isinstance(row.get("tokenCount"), dict) else {}
                    inp = _as_int(tc.get("inputTokens") if tc else 0)
                    out = _as_int(tc.get("outputTokens") if tc else 0)
                    model = row.get("model") or row.get("modelId") or "trae-assistant"
                    ts_ms = _to_ms(row.get("timestamp") or row.get("createdAt"))
                    messages.append(TokenMessage(
                        provider=PROVIDER_NAME,
                        model=model,
                        input_tokens=inp,
                        output_tokens=out,
                        reasoning_tokens=0,
                        cache_read_tokens=0,
                        cache_write_tokens=0,
                        cost=0.0,
                        timestamp_ms=ts_ms,
                        session_id=str(sid),
                        project="",
                    ))
                    session_ids.add(str(sid))

            # Single bubble entry
            if isinstance(obj.get("tokenCount"), dict):
                tc = obj["tokenCount"]
                inp = _as_int(tc.get("inputTokens"))
                out = _as_int(tc.get("outputTokens"))
                if inp or out:
                    messages.append(TokenMessage(
                        provider=PROVIDER_NAME,
                        model=obj.get("model") or obj.get("modelId") or "trae-assistant",
                        input_tokens=inp,
                        output_tokens=out,
                        reasoning_tokens=0,
                        cache_read_tokens=0,
                        cache_write_tokens=0,
                        cost=0.0,
                        timestamp_ms=_to_ms(obj.get("timestamp") or obj.get("createdAt")),
                        session_id=str(sid),
                        project="",
                    ))
                    session_ids.add(str(sid))

    conn.close()


def load() -> ProviderResult:
    roots = [r for r in _roots() if os.path.exists(r)]
    if not roots:
        return ProviderResult(name=PROVIDER_NAME, source="not found")

    messages = []
    session_ids = set()

    for root in roots:
        jsonl_files = glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True)
        for f in jsonl_files:
            _load_jsonl(f, messages, session_ids)

        sqlite_files = (
            glob.glob(os.path.join(root, "**", "*.vscdb"), recursive=True)
            + glob.glob(os.path.join(root, "**", "*.db"), recursive=True)
        )
        for f in sqlite_files:
            _load_sqlite(f, messages, session_ids)

    return ProviderResult(
        name=PROVIDER_NAME,
        messages=messages,
        sessions=len(session_ids),
        source="jsonl+sqlite",
    )
