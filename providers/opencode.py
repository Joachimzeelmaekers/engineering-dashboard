"""OpenCode provider — reads from opencode.db or JSON storage fallback."""

import glob
import json
import os
import sqlite3

from .base import TokenMessage, ProviderResult

PROVIDER_NAME = "opencode"

# Models to exclude (local inference)
EXCLUDE_PATTERNS = ("mlx", "qwen")


def _candidate_roots() -> list[str]:
    home = os.path.expanduser("~")
    return [
        os.path.join(home, ".local", "share", "opencode"),
        os.path.join(home, "Library", "Application Support", "opencode"),
        os.path.join(home, ".config", "opencode"),
    ]


def _load_sessions_sqlite(db_path: str):
    sessions = {}
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    for row in conn.execute("SELECT id, directory, title FROM session"):
        sessions[row[0]] = {"id": row[0], "directory": row[1], "title": row[2]}
    conn.close()
    return sessions


def _load_sessions_json(storage_dir: str):
    sessions = {}
    for f in glob.glob(f"{storage_dir}/session/**/*.json", recursive=True):
        try:
            d = json.load(open(f))
            sessions[d["id"]] = d
        except Exception:
            pass
    return sessions


def load() -> ProviderResult:
    roots = [r for r in _candidate_roots() if os.path.exists(r)]
    if not roots:
        return ProviderResult(name=PROVIDER_NAME, source="not found")

    sessions = {}
    raw_messages = []
    source = "json"

    for root in roots:
        db_path = os.path.join(root, "opencode.db")
        storage_dir = os.path.join(root, "storage")

        root_sessions = {}
        if os.path.exists(db_path):
            try:
                root_sessions = _load_sessions_sqlite(db_path)
            except Exception:
                root_sessions = _load_sessions_json(storage_dir)
        else:
            root_sessions = _load_sessions_json(storage_dir)
        sessions.update(root_sessions)

        loaded_from_sqlite = False
        if os.path.exists(db_path):
            try:
                conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
                for row in conn.execute("SELECT session_id, data FROM message"):
                    d = json.loads(row[1])
                    d["sessionID"] = row[0]
                    if d.get("role") == "assistant":
                        raw_messages.append(d)
                conn.close()
                loaded_from_sqlite = True
                source = "sqlite"
            except Exception:
                loaded_from_sqlite = False

        if not loaded_from_sqlite:
            for f in glob.glob(f"{storage_dir}/message/**/*.json", recursive=True):
                try:
                    d = json.load(open(f))
                    if d.get("role") == "assistant":
                        raw_messages.append(d)
                except Exception:
                    pass

    # Normalize
    messages = []
    session_ids = set()
    for msg in raw_messages:
        provider_id = msg.get("providerID", "unknown")
        model_id = msg.get("modelID", "unknown")
        model_key = f"{provider_id}/{model_id}"

        if any(p in model_key.lower() for p in EXCLUDE_PATTERNS):
            continue

        t = msg.get("tokens", {}) if isinstance(msg.get("tokens"), dict) else {}
        ts_ms = msg.get("time", {}).get("created", 0)

        # Resolve project from message or session
        project = msg.get("path", {}).get("root") or ""
        if not project:
            sess = sessions.get(msg.get("sessionID", ""), {})
            project = sess.get("directory", "")

        sid = msg.get("sessionID", "")
        session_ids.add(sid)

        messages.append(TokenMessage(
            provider=PROVIDER_NAME,
            model=model_id,
            input_tokens=t.get("input", 0),
            output_tokens=t.get("output", 0),
            reasoning_tokens=t.get("reasoning", 0),
            cache_read_tokens=t.get("cache", {}).get("read", 0),
            cache_write_tokens=t.get("cache", {}).get("write", 0),
            cost=msg.get("cost", 0.0) or 0.0,
            timestamp_ms=ts_ms,
            session_id=sid,
            project=project,
        ))

    return ProviderResult(
        name=PROVIDER_NAME,
        messages=messages,
        sessions=len(session_ids),
        source=source,
    )
