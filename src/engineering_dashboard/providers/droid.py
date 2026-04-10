"""Factory Droid provider — reads from ~/.factory/sessions/.

Each session directory contains:
  - <session-id>.jsonl: message log (session_start, message, todo_state entries)
  - <session-id>.settings.json: aggregate token usage, model, provider info

Since Droid only stores aggregate token usage per session (not per-message),
we emit one TokenMessage per session with the session totals.
"""

import glob
import json
import os
from datetime import datetime, timezone

from .base import TokenMessage, ProviderResult

PROVIDER_NAME = "droid"
SESSIONS_DIR = os.path.expanduser("~/.factory/sessions")


def _project_from_dir(dirname: str) -> str:
    """Convert session directory name back to a project path.

    Directory names look like: -Users-joachim-Work-blog
    """
    if not dirname or dirname == ".":
        return "unknown"
    return "/" + dirname.lstrip("-").replace("-", "/")


def _parse_session_jsonl(path: str) -> dict:
    """Extract metadata from a session JSONL file."""
    session_id = ""
    title = ""
    cwd = ""
    first_ts = 0
    last_ts = 0
    assistant_messages = 0

    with open(path) as f:
        for line in f:
            try:
                d = json.loads(line)
            except Exception:
                continue

            entry_type = d.get("type", "")

            if entry_type == "session_start":
                session_id = d.get("id", "")
                title = d.get("sessionTitle", "") or d.get("title", "")
                cwd = d.get("cwd", "")

            elif entry_type == "message":
                ts_str = d.get("timestamp", "")
                if ts_str:
                    try:
                        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        ts_ms = int(dt.timestamp() * 1000)
                        if not first_ts or ts_ms < first_ts:
                            first_ts = ts_ms
                        if ts_ms > last_ts:
                            last_ts = ts_ms
                    except Exception:
                        pass

                msg = d.get("message", {})
                if msg.get("role") == "assistant":
                    assistant_messages += 1

    return {
        "session_id": session_id,
        "title": title,
        "cwd": cwd,
        "first_ts": first_ts,
        "last_ts": last_ts,
        "assistant_messages": assistant_messages,
    }


def load() -> ProviderResult:
    if not os.path.isdir(SESSIONS_DIR):
        return ProviderResult(name=PROVIDER_NAME, source="not found")

    messages = []
    session_count = 0

    for project_dir in glob.glob(os.path.join(SESSIONS_DIR, "*")):
        if not os.path.isdir(project_dir):
            continue

        project_dirname = os.path.basename(project_dir)
        project = _project_from_dir(project_dirname)

        for settings_file in glob.glob(os.path.join(project_dir, "*.settings.json")):
            basename = os.path.basename(settings_file)
            session_id = basename.replace(".settings.json", "")
            jsonl_file = os.path.join(project_dir, f"{session_id}.jsonl")

            try:
                with open(settings_file) as f:
                    settings = json.load(f)
            except Exception:
                continue

            token_usage = settings.get("tokenUsage")
            if not token_usage:
                continue

            model = settings.get("model", "unknown")
            provider_lock = settings.get("apiProviderLock") or settings.get("providerLock", "")

            input_tokens = token_usage.get("inputTokens", 0)
            output_tokens = token_usage.get("outputTokens", 0)
            cache_read = token_usage.get("cacheReadTokens", 0)
            cache_creation = token_usage.get("cacheCreationTokens", 0)
            thinking = token_usage.get("thinkingTokens", 0)

            if input_tokens + output_tokens + cache_read + cache_creation == 0:
                continue

            # Parse JSONL for timestamps and message count
            meta = {"session_id": session_id, "first_ts": 0, "last_ts": 0, "assistant_messages": 1, "cwd": ""}
            if os.path.exists(jsonl_file):
                meta = _parse_session_jsonl(jsonl_file)

            session_project = project
            if meta.get("cwd"):
                session_project = meta["cwd"]

            timestamp_ms = meta.get("first_ts", 0)
            if not timestamp_ms:
                lock_ts = settings.get("providerLockTimestamp", "")
                if lock_ts:
                    try:
                        dt = datetime.fromisoformat(lock_ts.replace("Z", "+00:00"))
                        timestamp_ms = int(dt.timestamp() * 1000)
                    except Exception:
                        pass

            session_count += 1

            messages.append(TokenMessage(
                provider=PROVIDER_NAME,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                reasoning_tokens=thinking,
                cache_read_tokens=cache_read,
                cache_write_tokens=cache_creation,
                cost=0.0,
                timestamp_ms=timestamp_ms,
                session_id=session_id,
                project=session_project,
            ))

    return ProviderResult(
        name=PROVIDER_NAME,
        messages=messages,
        sessions=session_count,
        source="factory-sessions",
    )
