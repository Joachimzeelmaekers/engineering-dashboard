"""Cursor provider — extracts usage from global/workspace SQLite stores.

Coverage:
  - Global composer/agent storage (cursorDiskKV: composerData/bubbleId)
  - Workspace chat mode (ItemTable: workbench.panel.aichat...)
  - Legacy workspace composer data (ItemTable: composer.composerData)
"""

import glob
import json
import os
import sqlite3

from .base import TokenMessage, ProviderResult

PROVIDER_NAME = "cursor"


def _roots() -> list[str]:
    home = os.path.expanduser("~")
    return [
        os.path.join(home, "Library", "Application Support", "Cursor"),
        os.path.join(home, ".config", "Cursor"),
        os.path.join(home, ".local", "share", "Cursor"),
    ]


def _global_dbs() -> list[str]:
    dbs = []
    for root in _roots():
        p = os.path.join(root, "User", "globalStorage", "state.vscdb")
        if os.path.exists(p):
            dbs.append(p)
    return sorted(set(dbs))


def _workspace_dbs() -> list[str]:
    dbs = []
    for root in _roots():
        dbs.extend(glob.glob(os.path.join(root, "User", "workspaceStorage", "*", "state.vscdb")))
    return sorted(set([d for d in dbs if os.path.exists(d)]))


def _table_exists(conn, table: str) -> bool:
    try:
        row = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
        return bool(row)
    except Exception:
        return False


def _as_int(v) -> int:
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str) and v.isdigit():
        return int(v)
    return 0


def _extract_from_global_db(db_path: str, messages: list[TokenMessage], session_ids: set[str]):
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except Exception:
        return

    if not _table_exists(conn, "cursorDiskKV"):
        conn.close()
        return

    composers = {}

    # composer metadata
    try:
        rows = conn.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").fetchall()
    except Exception:
        rows = []

    for key, value in rows:
        if value is None:
            continue
        try:
            data = json.loads(value)
        except Exception:
            continue
        cid = data.get("composerId", key.split(":", 1)[1])
        mode = data.get("forceMode", "") or "default"
        created_at = _as_int(data.get("createdAt"))
        model_name = ((data.get("modelConfig") or {}).get("modelName") if isinstance(data.get("modelConfig"), dict) else None) or f"cursor-{mode}"
        session_ids.add(cid)

        bubble_ts = {}
        inline_conv = data.get("conversation", [])
        if isinstance(inline_conv, list):
            for bubble in inline_conv:
                if not isinstance(bubble, dict):
                    continue
                bid = bubble.get("bubbleId")
                if bid:
                    ti = bubble.get("timingInfo") if isinstance(bubble.get("timingInfo"), dict) else {}
                    ts = _as_int(ti.get("clientStartTime") or ti.get("clientEndTime"))
                    if ts:
                        bubble_ts[bid] = ts
                # inline assistant bubbles (sometimes no separate bubbleId row)
                role = bubble.get("role")
                btype = bubble.get("type")
                if role == "assistant" or btype == 2:
                    tc = bubble.get("tokenCount") if isinstance(bubble.get("tokenCount"), dict) else {}
                    inp = _as_int(tc.get("inputTokens"))
                    out = _as_int(tc.get("outputTokens"))
                    messages.append(TokenMessage(
                        provider=PROVIDER_NAME,
                        model=model_name,
                        input_tokens=inp,
                        output_tokens=out,
                        reasoning_tokens=0,
                        cache_read_tokens=0,
                        cache_write_tokens=0,
                        cost=0.0,
                        timestamp_ms=_as_int(bubble.get("timestamp")) or created_at,
                        session_id=cid,
                        project="",
                    ))

        composers[cid] = {"mode": mode, "created_at": created_at, "bubble_ts": bubble_ts, "model": model_name}

    # separate bubble rows
    try:
        rows = conn.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").fetchall()
    except Exception:
        rows = []

    for key, value in rows:
        if value is None:
            continue
        try:
            data = json.loads(value)
        except Exception:
            continue

        parts = key.split(":")
        composer_id = parts[1] if len(parts) >= 3 else ""
        bubble_id = parts[2] if len(parts) >= 3 else ""
        comp = composers.get(composer_id, {})
        model = comp.get("model") or f"cursor-{comp.get('mode', 'unknown')}"
        ts_ms = comp.get("bubble_ts", {}).get(bubble_id, 0) or comp.get("created_at", 0)

        # assistant only
        btype = data.get("type")
        role = data.get("role")
        if role != "assistant" and btype not in (2, "assistant"):
            continue

        tc = data.get("tokenCount") if isinstance(data.get("tokenCount"), dict) else {}
        inp = _as_int(tc.get("inputTokens"))
        out = _as_int(tc.get("outputTokens"))

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
            session_id=composer_id,
            project="",
        ))
        if composer_id:
            session_ids.add(composer_id)

    conn.close()


def _extract_from_workspace_db(db_path: str, messages: list[TokenMessage], session_ids: set[str]):
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except Exception:
        return

    if not _table_exists(conn, "ItemTable"):
        conn.close()
        return

    # Chat mode
    try:
        row = conn.execute(
            "SELECT value FROM ItemTable WHERE key = 'workbench.panel.aichat.view.aichat.chatdata'"
        ).fetchone()
    except Exception:
        row = None
    if row and row[0]:
        try:
            data = json.loads(row[0])
            tabs = data.get("tabs", []) if isinstance(data, dict) else []
            for tab in tabs:
                if not isinstance(tab, dict):
                    continue
                sid = str(tab.get("tabId") or os.path.basename(os.path.dirname(db_path)))
                session_ids.add(sid)
                for bubble in tab.get("bubbles", []):
                    if not isinstance(bubble, dict):
                        continue
                    btype = bubble.get("type")
                    if btype != "assistant":
                        continue
                    messages.append(TokenMessage(
                        provider=PROVIDER_NAME,
                        model="cursor-chat",
                        input_tokens=0,
                        output_tokens=0,
                        reasoning_tokens=0,
                        cache_read_tokens=0,
                        cache_write_tokens=0,
                        cost=0.0,
                        timestamp_ms=0,
                        session_id=sid,
                        project="",
                    ))
        except Exception:
            pass

    # Legacy workspace composer data
    try:
        row = conn.execute("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").fetchone()
    except Exception:
        row = None
    if row and row[0]:
        try:
            data = json.loads(row[0])
            composers = data.get("allComposers", []) if isinstance(data, dict) else []
            for comp in composers:
                if not isinstance(comp, dict):
                    continue
                sid = comp.get("composerId") or "workspace-composer"
                session_ids.add(str(sid))
                model = ((comp.get("modelConfig") or {}).get("modelName") if isinstance(comp.get("modelConfig"), dict) else None) or "cursor-composer"
                for bubble in comp.get("conversation", []):
                    if not isinstance(bubble, dict):
                        continue
                    if bubble.get("type") != 2 and bubble.get("role") != "assistant":
                        continue
                    tc = bubble.get("tokenCount") if isinstance(bubble.get("tokenCount"), dict) else {}
                    messages.append(TokenMessage(
                        provider=PROVIDER_NAME,
                        model=model,
                        input_tokens=_as_int(tc.get("inputTokens")),
                        output_tokens=_as_int(tc.get("outputTokens")),
                        reasoning_tokens=0,
                        cache_read_tokens=0,
                        cache_write_tokens=0,
                        cost=0.0,
                        timestamp_ms=_as_int(bubble.get("timestamp")) or _as_int(comp.get("createdAt")),
                        session_id=str(sid),
                        project="",
                    ))
        except Exception:
            pass

    conn.close()


def load() -> ProviderResult:
    global_dbs = _global_dbs()
    workspace_dbs = _workspace_dbs()
    if not global_dbs and not workspace_dbs:
        return ProviderResult(name=PROVIDER_NAME, source="not found")

    messages = []
    session_ids = set()

    for db in global_dbs:
        _extract_from_global_db(db, messages, session_ids)
    for db in workspace_dbs:
        _extract_from_workspace_db(db, messages, session_ids)

    return ProviderResult(
        name=PROVIDER_NAME,
        messages=messages,
        sessions=len(session_ids),
        source="vscdb",
    )
