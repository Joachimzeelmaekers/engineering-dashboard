"""Windsurf provider — extracts chat/agent usage from VSCode-like SQLite stores."""

import glob
import json
import os
import sqlite3

from .base import TokenMessage, ProviderResult

PROVIDER_NAME = "windsurf"


def _install_roots() -> list[str]:
    home = os.path.expanduser("~")
    return [
        os.path.join(home, "Library", "Application Support", "Windsurf"),
        os.path.join(home, ".config", "Windsurf"),
        os.path.join(home, ".local", "share", "Windsurf"),
        os.path.join(home, ".config", "windsurf"),
        os.path.join(home, ".local", "share", "windsurf"),
    ]


def _db_paths() -> list[str]:
    paths = []
    for root in _install_roots():
        if not os.path.exists(root):
            continue
        paths.append(os.path.join(root, "User", "globalStorage", "state.vscdb"))
        paths.extend(glob.glob(os.path.join(root, "User", "workspaceStorage", "*", "state.vscdb")))
    return sorted(set([p for p in paths if os.path.exists(p)]))


def _table_exists(conn, table: str) -> bool:
    try:
        row = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
        return bool(row)
    except Exception:
        return False


def _iter_kv_rows(conn):
    patterns = [
        "%chat%", "%conversation%", "%agent%", "%composerData:%", "%bubbleId:%", "%cascade%", "%flow%",
    ]
    for table in ("cursorDiskKV", "ItemTable"):
        if not _table_exists(conn, table):
            continue
        for pat in patterns:
            try:
                for key, value in conn.execute(f"SELECT key, value FROM {table} WHERE key LIKE ?", (pat,)):
                    yield key, value
            except Exception:
                continue


def _as_int(value) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return 0


def _messages_from_obj(obj, session_hint: str) -> list[TokenMessage]:
    out = []
    if not isinstance(obj, dict):
        return out

    # Cursor-like bubble entry with tokenCount
    if isinstance(obj.get("tokenCount"), dict):
        tc = obj["tokenCount"]
        inp = _as_int(tc.get("inputTokens"))
        o = _as_int(tc.get("outputTokens"))
        if inp + o > 0:
            out.append(TokenMessage(
                provider=PROVIDER_NAME,
                model="windsurf-agent",
                input_tokens=inp,
                output_tokens=o,
                reasoning_tokens=0,
                cache_read_tokens=0,
                cache_write_tokens=0,
                cost=0.0,
                timestamp_ms=0,
                session_id=session_hint,
                project="",
            ))

    # chatdata tabs/bubbles (assistant message count; usually no tokens)
    tabs = obj.get("tabs")
    if isinstance(tabs, list):
        for tab in tabs:
            if not isinstance(tab, dict):
                continue
            tab_id = tab.get("tabId") or session_hint
            for bubble in tab.get("bubbles", []):
                if not isinstance(bubble, dict):
                    continue
                bubble_type = bubble.get("type")
                if bubble_type in ("assistant", 2):
                    out.append(TokenMessage(
                        provider=PROVIDER_NAME,
                        model="windsurf-chat",
                        input_tokens=0,
                        output_tokens=0,
                        reasoning_tokens=0,
                        cache_read_tokens=0,
                        cache_write_tokens=0,
                        cost=0.0,
                        timestamp_ms=0,
                        session_id=str(tab_id),
                        project="",
                    ))

    # generic conversation arrays
    for key in ("conversation", "messages"):
        rows = obj.get(key)
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            role = row.get("role")
            bubble_type = row.get("type")
            is_assistant = role == "assistant" or bubble_type in ("assistant", 2)
            if not is_assistant:
                continue
            tc = row.get("tokenCount") if isinstance(row.get("tokenCount"), dict) else {}
            inp = _as_int(tc.get("inputTokens"))
            o = _as_int(tc.get("outputTokens"))
            out.append(TokenMessage(
                provider=PROVIDER_NAME,
                model=row.get("model") or row.get("modelId") or "windsurf-agent",
                input_tokens=inp,
                output_tokens=o,
                reasoning_tokens=0,
                cache_read_tokens=0,
                cache_write_tokens=0,
                cost=0.0,
                timestamp_ms=0,
                session_id=session_hint,
                project="",
            ))

    return out


def load() -> ProviderResult:
    dbs = _db_paths()
    if not dbs:
        return ProviderResult(name=PROVIDER_NAME, source="not found")

    messages = []
    session_ids = set()

    for db in dbs:
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        except Exception:
            continue

        for key, value in _iter_kv_rows(conn):
            if value is None:
                continue
            try:
                obj = json.loads(value)
            except Exception:
                continue

            sid = key.split(":")[1] if ":" in key else key
            msgs = _messages_from_obj(obj, sid)
            if msgs:
                messages.extend(msgs)
                for m in msgs:
                    if m.session_id:
                        session_ids.add(m.session_id)

        conn.close()

    return ProviderResult(
        name=PROVIDER_NAME,
        messages=messages,
        sessions=len(session_ids),
        source="vscdb",
    )
