#!/usr/bin/env python3
"""
Engineering Report Generator.
Collects AI tool usage, GitHub PR/review stats, and generates a self-contained HTML dashboard.
"""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

from providers.base import ProviderResult
from providers import opencode, claude, cursor, codex, continueai, gemini, trae, windsurf, droid
from providers import github_prs
from pricing import estimate_cost
from report import build_html
from cache import cached_load
from config import is_provider_enabled, is_github_enabled, max_reports

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(os.path.dirname(TOOL_DIR))
REPORTS_DIR = os.path.join(TOOL_DIR, "output")
DATA_DIR = os.path.join(TOOL_DIR, "data")

# Register providers here — (name, load_fn)
ALL_PROVIDERS = [
    ("claude-code", claude.load),
    ("opencode", opencode.load),
    ("cursor", cursor.load),
    ("codex", codex.load),
    ("continue", continueai.load),
    ("gemini", gemini.load),
    ("trae", trae.load),
    ("windsurf", windsurf.load),
    ("droid", droid.load),
]
PROVIDERS = [(name, fn) for name, fn in ALL_PROVIDERS if is_provider_enabled(name)]


def fmt_tokens(n: int) -> str:
    return f"{n:,}"


def aggregate(results: list[ProviderResult]) -> dict:
    """Build all aggregated views from normalized provider results."""

    model_stats = defaultdict(lambda: {
        "messages": 0,
        "input": 0, "output": 0, "reasoning": 0,
        "cache_read": 0, "cache_write": 0,
        "cost_logged": 0.0, "cost_estimated": 0.0,
        "provider": "",
    })

    hourly = defaultdict(lambda: defaultdict(lambda: {"input": 0, "output": 0}))

    project_stats = defaultdict(lambda: defaultdict(lambda: {
        "messages": 0, "input": 0, "output": 0,
    }))

    total_messages = 0
    total_sessions = 0

    now = datetime.now(timezone.utc)
    current_month = now.strftime("%Y-%m")

    month_stats = defaultdict(lambda: {
        "messages": 0,
        "input": 0, "output": 0, "reasoning": 0,
        "cache_read": 0, "cache_write": 0,
        "cost_logged": 0.0, "cost_estimated": 0.0,
    })

    # Per-provider totals for the summary
    provider_totals = defaultdict(lambda: {
        "messages": 0, "sessions": 0,
        "input": 0, "output": 0,
        "cost_estimated": 0.0,
    })

    for result in results:
        total_sessions += result.sessions
        provider_totals[result.name]["sessions"] += result.sessions

        for msg in result.messages:
            # Include provider in key to avoid collisions (e.g. gpt-5.3-codex used by both opencode and codex)
            model_key = f"{msg.model} [{msg.provider}]" if msg.provider else msg.model

            ms = model_stats[model_key]
            ms["messages"] += 1
            ms["input"] += msg.input_tokens
            ms["output"] += msg.output_tokens
            ms["reasoning"] += msg.reasoning_tokens
            ms["cache_read"] += msg.cache_read_tokens
            ms["cache_write"] += msg.cache_write_tokens
            ms["cost_logged"] += msg.cost
            ms["provider"] = msg.provider

            # Hourly bucket
            if msg.timestamp_ms:
                dt = datetime.fromtimestamp(msg.timestamp_ms / 1000, tz=timezone.utc)
                hour_key = dt.strftime("%Y-%m-%dT%H")
                hourly[hour_key][model_key]["input"] += msg.input_tokens
                hourly[hour_key][model_key]["output"] += msg.output_tokens

                # Current month
                if dt.strftime("%Y-%m") == current_month:
                    mm = month_stats[model_key]
                    mm["messages"] += 1
                    mm["input"] += msg.input_tokens
                    mm["output"] += msg.output_tokens
                    mm["reasoning"] += msg.reasoning_tokens
                    mm["cache_read"] += msg.cache_read_tokens
                    mm["cache_write"] += msg.cache_write_tokens
                    mm["cost_logged"] += msg.cost

            # Project bucket
            project = msg.project or "unknown"
            project_stats[project][model_key]["messages"] += 1
            project_stats[project][model_key]["input"] += msg.input_tokens
            project_stats[project][model_key]["output"] += msg.output_tokens

            total_messages += 1

            # Provider totals
            pt = provider_totals[msg.provider]
            pt["messages"] += 1
            pt["input"] += msg.input_tokens
            pt["output"] += msg.output_tokens

    # Compute estimated costs
    for model_key, ms in model_stats.items():
        ms["cost_estimated"] = estimate_cost(
            model_key, ms["input"], ms["output"], ms["cache_read"], ms["cache_write"]
        )

    month_cost_estimated = 0.0
    for model_key, mm in month_stats.items():
        mm["cost_estimated"] = estimate_cost(
            model_key, mm["input"], mm["output"], mm["cache_read"], mm["cache_write"]
        )
        month_cost_estimated += mm["cost_estimated"]

    for pname, pt in provider_totals.items():
        pt["cost_estimated"] = sum(
            ms["cost_estimated"] for mk, ms in model_stats.items()
            if ms["provider"] == pname
        )

    return {
        "model_stats": dict(model_stats),
        "hourly": {k: dict(v) for k, v in hourly.items()},
        "project_stats": {k: dict(v) for k, v in project_stats.items()},
        "provider_totals": dict(provider_totals),
        "total_messages": total_messages,
        "total_sessions": total_sessions,
        "month_cost_estimated": month_cost_estimated,
        "month_stats": dict(month_stats),
        "current_month": current_month,
    }


def _msg_to_dict(msg) -> dict:
    """Convert TokenMessage to dict for JSON serialization."""
    return {
        "provider": msg.provider,
        "model": msg.model,
        "input_tokens": msg.input_tokens,
        "output_tokens": msg.output_tokens,
        "reasoning_tokens": msg.reasoning_tokens,
        "cache_read_tokens": msg.cache_read_tokens,
        "cache_write_tokens": msg.cache_write_tokens,
        "cost": msg.cost,
        "timestamp_ms": msg.timestamp_ms,
        "session_id": msg.session_id,
        "project": msg.project,
    }


def _dict_to_msg(d: dict):
    """Convert dict back to TokenMessage."""
    from providers.base import TokenMessage
    return TokenMessage(
        provider=d["provider"],
        model=d["model"],
        input_tokens=d["input_tokens"],
        output_tokens=d["output_tokens"],
        reasoning_tokens=d["reasoning_tokens"],
        cache_read_tokens=d["cache_read_tokens"],
        cache_write_tokens=d["cache_write_tokens"],
        cost=d["cost"],
        timestamp_ms=d["timestamp_ms"],
        session_id=d["session_id"],
        project=d["project"],
    )


def _load_all_snapshots() -> list:
    """Load only the most recent snapshot (contains all historical data)."""
    import glob
    snapshots = glob.glob(os.path.join(DATA_DIR, "snapshots", "*.json"))
    if not snapshots:
        return []
    # Just load the latest - it already contains all historical data
    latest = max(snapshots)
    try:
        with open(latest) as f:
            return [json.load(f)]
    except Exception:
        return []


def _merge_results(fresh_results: list[ProviderResult]) -> list[ProviderResult]:
    """Merge fresh provider data with historical snapshots to get complete dataset."""
    import glob
    
    # Dedupe key: (provider, session_id, timestamp_ms, model, input_tokens, output_tokens)
    seen = set()
    merged_by_provider = defaultdict(list)
    
    # First, load all historical snapshots
    for snapshot in _load_all_snapshots():
        for provider_name, provider_data in snapshot.items():
            for msg_dict in provider_data.get("messages", []):
                key = (
                    msg_dict["provider"],
                    msg_dict["session_id"],
                    msg_dict["timestamp_ms"],
                    msg_dict["model"],
                    msg_dict["input_tokens"],
                    msg_dict["output_tokens"],
                )
                if key not in seen:
                    seen.add(key)
                    merged_by_provider[provider_name].append(msg_dict)
    
    # Then add fresh data (to capture new sessions since last snapshot)
    for result in fresh_results:
        for msg in result.messages:
            msg_dict = _msg_to_dict(msg)
            key = (
                msg_dict["provider"],
                msg_dict["session_id"],
                msg_dict["timestamp_ms"],
                msg_dict["model"],
                msg_dict["input_tokens"],
                msg_dict["output_tokens"],
            )
            if key not in seen:
                seen.add(key)
                merged_by_provider[result.name].append(msg_dict)
    
    # Convert back to ProviderResult
    from providers.base import ProviderResult
    results = []
    for name, load_fn in PROVIDERS:
        messages = [_dict_to_msg(m) for m in merged_by_provider.get(name, [])]
        sessions = len(set(m.session_id for m in messages))
        # Determine source - if has historical data, note it
        source = "merged"
        if messages:
            source = "merged+snapshot"
        results.append(ProviderResult(
            name=name,
            messages=messages,
            sessions=sessions,
            source=source,
        ))
    
    return results


def snapshot_data(results: list[ProviderResult]):
    """Save a timestamped snapshot with ALL raw messages for full reproducibility."""
    os.makedirs(os.path.join(DATA_DIR, "snapshots"), exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    snapshot_file = os.path.join(DATA_DIR, "snapshots", f"{ts}.json")

    snapshot = {}
    for result in results:
        snapshot[result.name] = {
            "source": result.source,
            "sessions": result.sessions,
            "message_count": len(result.messages),
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "messages": [_msg_to_dict(msg) for msg in result.messages],
        }

    with open(snapshot_file, "w") as f:
        json.dump(snapshot, f, indent=2)
    print(f"  Data snapshot: {snapshot_file}")


def _cleanup_reports(reports_dir: str):
    """Keep only the latest N timestamped report files."""
    import glob as g
    keep = max_reports()
    files = sorted(g.glob(os.path.join(reports_dir, "report_*.html")))
    if len(files) > keep:
        for old in files[:-keep]:
            os.remove(old)
            print(f"  Removed old report: {os.path.basename(old)}")


def load_presentations() -> list[dict]:
    """Load markdown presentations from the presentations directory."""
    presentations = []
    if not os.path.isdir(PRESENTATIONS_DIR):
        return presentations
    import glob as g
    for path in sorted(g.glob(os.path.join(PRESENTATIONS_DIR, "*.md"))):
        name = os.path.splitext(os.path.basename(path))[0]
        with open(path) as f:
            content = f.read()
        # Extract title from first heading
        title = name.replace("-", " ").title()
        for line in content.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
        presentations.append({
            "name": name,
            "title": title,
            "content": content,
        })
    return presentations


def main():
    os.makedirs(REPORTS_DIR, exist_ok=True)

    print("Loading providers...")
    fresh_results = []
    for name, load_fn in PROVIDERS:
        result = load_fn()  # Direct load, not cached (cache is for incremental, snapshots handle persistence)
        print(f"  {result.name}: {len(result.messages)} messages, {result.sessions} sessions ({result.source})")
        fresh_results.append(result)

    all_messages = sum(len(r.messages) for r in fresh_results)
    if not all_messages:
        print("No messages found from any provider.")
        sys.exit(1)

    print("\nMerging with historical snapshots...")
    results = _merge_results(fresh_results)
    total_messages = sum(len(r.messages) for r in results)
    for r in results:
        print(f"  {r.name}: {len(r.messages)} messages, {r.sessions} sessions ({r.source})")

    print(f"\nTotal: {total_messages} messages across {len(results)} providers (including historical)")

    # Save fresh+merged to cache for next run's incremental loading
    from cache import save_cache
    for r in results:
        save_cache(r.name, r.messages, r.sessions)

    snapshot_data(results)

    print("Aggregating...")
    data = aggregate(results)
    data["messages"] = [
        _msg_to_dict(msg)
        for result in results
        for msg in result.messages
    ]

    if is_github_enabled():
        print("Loading GitHub PR data...")
        gh_result = github_prs.load()
        pr_stats = github_prs.compute_stats(gh_result)
        data["github_prs"] = pr_stats
        print(f"  GitHub PRs: {pr_stats['total']} total ({pr_stats['merged']} merged, {pr_stats['open']} open)")
        print(f"  GitHub Reviews: {pr_stats['reviews']['total']} total")
    else:
        print("GitHub provider disabled, skipping...")


    print("Generating HTML...")
    html = build_html(data)

    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_file = os.path.join(REPORTS_DIR, f"report_{ts}.html")
    latest = os.path.join(REPORTS_DIR, "latest.html")

    with open(out_file, "w") as f:
        f.write(html)
    with open(latest, "w") as f:
        f.write(html)

    # Clean up old reports, keep only the latest MAX_REPORTS
    _cleanup_reports(REPORTS_DIR)

    print(f"\nReport saved:")
    print(f"  {out_file}")
    print(f"  {latest}")
    print(f"\nOpen with:  open {latest}")

    # Summary
    ms = data["model_stats"]
    total_in = sum(v["input"] for v in ms.values())
    total_out = sum(v["output"] for v in ms.values())
    print(f"\nSummary:")
    print(f"  Sessions : {data['total_sessions']:,}")
    print(f"  Messages : {data['total_messages']:,}")
    print(f"  Input    : {total_in:,} tokens")
    print(f"  Output   : {total_out:,} tokens")

    for pname, pt in sorted(data["provider_totals"].items()):
        print(f"\n  [{pname}]")
        print(f"    Messages: {pt['messages']:,}  Sessions: {pt['sessions']:,}")
        print(f"    Input: {pt['input']:,}  Output: {pt['output']:,}")
        print(f"    Est. Cost: ${pt['cost_estimated']:.2f}")

    print()
    for key, v in sorted(ms.items(), key=lambda x: x[1]["input"] + x[1]["output"], reverse=True):
        print(f"  {key:<40}  {v['input']+v['output']:>12,} tokens  ({v['messages']} msgs)  [{v['provider']}]")


if __name__ == "__main__":
    main()
