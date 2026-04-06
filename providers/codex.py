"""Codex CLI provider — reads from Codex session JSONL files.

Each session has:
  - session_meta: id, timestamp, cwd, model_provider, cli_version
  - event_msg with type=token_count: total_token_usage and last_token_usage
  - We use total_token_usage from the last token_count event per session
    (it's cumulative, so the final one has the full session total).
"""

import glob
import json
import os
from datetime import datetime, timezone

from .base import TokenMessage, ProviderResult

PROVIDER_NAME = "codex"


def _installation_dirs() -> list[str]:
    home = os.path.expanduser("~")
    candidates = [
        os.path.join(home, ".codex"),
        os.path.join(home, ".codex-local"),
        os.path.join(home, "codex"),
        os.path.join(home, "codex-local"),
        os.path.join(home, ".config", "codex"),
        os.path.join(home, ".local", "share", "codex"),
    ]
    return [p for p in sorted(set(candidates)) if os.path.exists(p)]


def _get_configured_model(config_file: str) -> str:
    """Read model from config.toml."""
    if not os.path.exists(config_file):
        return "gpt-5.3-codex"
    try:
        with open(config_file) as f:
            for line in f:
                line = line.strip()
                if line.startswith("model") and "=" in line:
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return "gpt-5.3-codex"


def load() -> ProviderResult:
    install_dirs = _installation_dirs()
    if not install_dirs:
        return ProviderResult(name=PROVIDER_NAME, source="not found")

    messages = []
    session_ids = set()

    files = []
    models_by_root = {}
    for root in install_dirs:
        models_by_root[root] = _get_configured_model(os.path.join(root, "config.toml"))
        files.extend(glob.glob(os.path.join(root, "sessions", "**", "*.jsonl"), recursive=True))
        files.extend(glob.glob(os.path.join(root, "projects", "**", "*.jsonl"), recursive=True))
    files = sorted(set(files))

    for filepath in files:
        root = ""
        for r in install_dirs:
            if filepath.startswith(r):
                root = r
                break
        model = models_by_root.get(root, "gpt-5.3-codex")

        meta = None
        last_total_usage = None

        with open(filepath) as f:
            for line in f:
                try:
                    d = json.loads(line)
                except Exception:
                    continue

                t = d.get("type")
                p = d.get("payload", {})

                if t == "session_meta":
                    meta = p
                elif t == "event_msg" and isinstance(p, dict) and p.get("type") == "token_count":
                    info = p.get("info")
                    if info and info.get("total_token_usage"):
                        last_total_usage = info["total_token_usage"]
                elif t == "event_msg" and isinstance(p, dict) and p.get("type") == "agent_message":
                    model = p.get("model") or p.get("modelId") or model

        if not meta and not last_total_usage:
            continue

        sid = (meta or {}).get("id", "") or os.path.splitext(os.path.basename(filepath))[0]
        session_ids.add(sid)

        ts_ms = 0
        ts_str = (meta or {}).get("timestamp", "")
        if ts_str:
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                ts_ms = int(dt.timestamp() * 1000)
            except Exception:
                pass

        project = (meta or {}).get("cwd", "")

        usage = last_total_usage or {}
        inp = usage.get("input_tokens", 0)
        out = usage.get("output_tokens", 0)
        cached = usage.get("cached_input_tokens", 0)
        reasoning = usage.get("reasoning_output_tokens", 0)

        messages.append(TokenMessage(
            provider=PROVIDER_NAME,
            model=model,
            input_tokens=inp,
            output_tokens=out,
            reasoning_tokens=reasoning,
            cache_read_tokens=cached,
            cache_write_tokens=0,
            cost=0.0,
            timestamp_ms=ts_ms,
            session_id=sid,
            project=project,
        ))

    return ProviderResult(
        name=PROVIDER_NAME,
        messages=messages,
        sessions=len(session_ids),
        source="jsonl",
    )
