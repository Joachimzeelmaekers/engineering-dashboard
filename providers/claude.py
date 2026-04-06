"""Claude Code provider — reads from ~/.claude/.

Strategy:
  1. stats-cache.json modelUsage = authoritative totals up to lastComputedDate
  2. dailyModelTokens = per-day input+output breakdown (for timeline)
  3. JSONL session files = live data AFTER lastComputedDate (the gap)
  4. Combine without double-counting.

For timeline accuracy, we emit one message per day per model from dailyModelTokens.
Cache/cost totals come from modelUsage (allocated to the last day as a lump).
"""

import glob
import json
import os
from datetime import datetime, timezone

from .base import TokenMessage, ProviderResult

PROVIDER_NAME = "claude-code"


def _claude_dirs() -> list[str]:
    home = os.path.expanduser("~")
    names = [
        ".claude", ".claude-code", ".claude-local", ".claude-m2", ".claude-zai",
        "claude", "claude-code", "claude-local", "claude-m2", "claude-zai",
    ]
    dirs = [
        os.path.join(home, n) for n in names
    ] + [
        os.path.join(home, "Library", "Application Support", n) for n in names
    ] + [
        os.path.join(home, ".config", n) for n in names
    ]
    return [d for d in sorted(set(dirs)) if os.path.exists(d)]


def _load_session_projects(history_file: str) -> dict:
    mapping = {}
    if not os.path.exists(history_file):
        return mapping
    with open(history_file) as f:
        for line in f:
            try:
                d = json.loads(line)
                sid = d.get("sessionId", "")
                proj = d.get("project", "")
                if sid and proj:
                    mapping[sid] = proj
            except Exception:
                pass
    return mapping


def _project_from_dirname(dirname: str) -> str:
    if not dirname or dirname.startswith("."):
        return ""
    return "/" + dirname.replace("-", "/", 1).replace("-", "/") if dirname.startswith("-") else dirname


def _date_to_ms(date_str: str) -> int:
    """Convert YYYY-MM-DD to epoch ms (noon UTC)."""
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(
        hour=12, tzinfo=timezone.utc
    )
    return int(dt.timestamp() * 1000)


def load() -> ProviderResult:
    claude_dirs = _claude_dirs()
    if not claude_dirs:
        return ProviderResult(name=PROVIDER_NAME, source="not found")

    messages = []
    session_ids = set()
    total_cache_sessions = 0

    has_stats_cache = False

    for claude_dir in claude_dirs:
        history_file = os.path.join(claude_dir, "history.jsonl")
        projects_dir = os.path.join(claude_dir, "projects")
        stats_cache = os.path.join(claude_dir, "stats-cache.json")

        session_projects = _load_session_projects(history_file)

    # -------------------------------------------------------------------------
    # Step 1: Load stats-cache
    # -------------------------------------------------------------------------
        model_usage = {}
        daily_model_tokens = []
        last_computed = ""
        cache_sessions = 0
        cutoff_ms = 0

        if os.path.exists(stats_cache):
            try:
                cache_data = json.load(open(stats_cache))
                model_usage = cache_data.get("modelUsage", {})
                daily_model_tokens = cache_data.get("dailyModelTokens", [])
                if model_usage or daily_model_tokens:
                    has_stats_cache = True
                last_computed = cache_data.get("lastComputedDate", "")
                cache_sessions = cache_data.get("totalSessions", 0)
                total_cache_sessions += cache_sessions

                if last_computed:
                    cutoff_dt = datetime.strptime(last_computed, "%Y-%m-%d").replace(
                        hour=23, minute=59, second=59, tzinfo=timezone.utc
                    )
                    cutoff_ms = int(cutoff_dt.timestamp() * 1000)
            except Exception:
                pass

    # -------------------------------------------------------------------------
    # Step 2: Emit daily messages from dailyModelTokens (for timeline)
    # dailyModelTokens has combined input+output per day per model.
    # We split 50/50 as input/output (rough but gives correct totals on timeline).
    # -------------------------------------------------------------------------
        daily_sums = {}  # model -> total tokens emitted from daily data
        for entry in daily_model_tokens:
            date = entry.get("date", "")
            ts_ms = _date_to_ms(date) if date else 0
            for model, tokens in entry.get("tokensByModel", {}).items():
                if tokens <= 0:
                    continue
                daily_sums[model] = daily_sums.get(model, 0) + tokens
                # Split into input/output using the model's overall ratio from modelUsage
                mu = model_usage.get(model, {})
                mu_inp = mu.get("inputTokens", 0)
                mu_out = mu.get("outputTokens", 0)
                mu_total = mu_inp + mu_out
                if mu_total > 0:
                    inp = int(tokens * mu_inp / mu_total)
                    out = tokens - inp
                else:
                    inp = tokens // 2
                    out = tokens - inp

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
                    session_id="__stats_cache__",
                    project="(historical)",
                ))

    # -------------------------------------------------------------------------
    # Step 3: Emit remainder from modelUsage (cache tokens, cost, any gap)
    # The daily data covers input+output but not cache tokens.
    # Emit one message per model for the cache/remainder portion.
    # -------------------------------------------------------------------------
        for model, mu in model_usage.items():
            total_inp = mu.get("inputTokens", 0)
            total_out = mu.get("outputTokens", 0)
            cr = mu.get("cacheReadInputTokens", 0)
            cw = mu.get("cacheCreationInputTokens", 0)

            # Subtract what daily messages already covered
            daily_covered = daily_sums.get(model, 0)
            mu_total = total_inp + total_out
            remaining = mu_total - daily_covered

            # Only emit if there are cache tokens or remaining input/output
            if cr + cw + max(0, remaining) == 0:
                continue

            # Split remaining into input/output with same ratio
            if mu_total > 0 and remaining > 0:
                rem_inp = int(remaining * total_inp / mu_total)
                rem_out = remaining - rem_inp
            else:
                rem_inp = max(0, remaining) // 2
                rem_out = max(0, remaining) - rem_inp

            messages.append(TokenMessage(
                provider=PROVIDER_NAME,
                model=model,
                input_tokens=max(0, rem_inp),
                output_tokens=max(0, rem_out),
                reasoning_tokens=0,
                cache_read_tokens=cr,
                cache_write_tokens=cw,
                cost=0.0,
                timestamp_ms=cutoff_ms,
                session_id="__stats_cache_remainder__",
                project="(historical)",
            ))

    # -------------------------------------------------------------------------
    # Step 4: Load JSONL for the gap (after lastComputedDate)
    # -------------------------------------------------------------------------
        jsonl_files = (
            glob.glob(f"{projects_dir}/*/*.jsonl")
            + glob.glob(f"{projects_dir}/*/*/subagents/*.jsonl")
        )

        for filepath in jsonl_files:
            parts = filepath.replace(projects_dir + "/", "").split("/")
            project_dirname = parts[0] if parts else ""

            with open(filepath) as f:
                for line in f:
                    try:
                        d = json.loads(line)
                    except Exception:
                        continue

                    if d.get("type") != "assistant":
                        continue

                    msg = d.get("message")
                    if not isinstance(msg, dict) or "usage" not in msg:
                        continue

                    model = msg.get("model", "")
                    if not model or model == "<synthetic>":
                        continue

                    timestamp = d.get("timestamp", "")
                    ts_ms = 0
                    if timestamp:
                        try:
                            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                            ts_ms = int(dt.timestamp() * 1000)
                        except Exception:
                            pass

                    # Skip anything already covered by stats-cache
                    if cutoff_ms and ts_ms and ts_ms <= cutoff_ms:
                        continue

                    sid = d.get("sessionId", "")
                    project = session_projects.get(sid, "")
                    if not project:
                        project = _project_from_dirname(project_dirname)

                    session_ids.add(sid)
                    usage = msg["usage"]

                    messages.append(TokenMessage(
                        provider=PROVIDER_NAME,
                        model=model,
                        input_tokens=usage.get("input_tokens", 0),
                        output_tokens=usage.get("output_tokens", 0),
                        reasoning_tokens=0,
                        cache_read_tokens=usage.get("cache_read_input_tokens", 0),
                        cache_write_tokens=usage.get("cache_creation_input_tokens", 0),
                        cost=d.get("costUSD", 0.0) or 0.0,
                        timestamp_ms=ts_ms,
                        session_id=sid,
                        project=project,
                    ))

    total_sessions = max(total_cache_sessions, len(session_ids))
    source = "stats-cache+jsonl" if has_stats_cache else "jsonl"

    return ProviderResult(
        name=PROVIDER_NAME,
        messages=messages,
        sessions=total_sessions,
        source=source,
    )
