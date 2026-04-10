"""GitHub Pull Request statistics provider.

Fetches all PRs authored by the authenticated user via the GitHub GraphQL API.
Uses incremental caching: fetches all PRs once, then only fetches new PRs since
the most recent cached PR on subsequent runs.
"""

import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from ..config import github_history_start_year
from ..paths import DATA_DIR


@dataclass
class PullRequest:
    title: str
    repo: str  # owner/name
    org: str
    created_at: str  # ISO 8601
    merged_at: str | None
    closed_at: str | None
    state: str  # OPEN, CLOSED, MERGED
    additions: int
    deletions: int
    changed_files: int
    url: str


@dataclass
class Review:
    pr_title: str
    pr_url: str
    repo: str
    org: str
    review_created_at: str  # ISO 8601 - when the review was submitted
    state: str  # APPROVED, COMMENTED, CHANGES_REQUESTED, DISMISSED
    additions: int
    deletions: int
    changed_files: int


@dataclass
class GitHubPRResult:
    prs: list  # list[PullRequest]
    reviews: list  # list[Review]
    total: int
    source: str = "github-graphql"


CACHE_FILE = os.path.join(DATA_DIR, "cache_github_prs.json")
REVIEW_CACHE_FILE = os.path.join(DATA_DIR, "cache_github_reviews.json")


def _run_gh(query: str) -> dict:
    """Run a GraphQL query via gh CLI."""
    result = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={query}"],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        print(f"  [github] gh api error: {result.stderr.strip()}", file=sys.stderr)
        return {}
    return json.loads(result.stdout)


def _parse_nodes(nodes: list) -> list[PullRequest]:
    prs = []
    for n in nodes:
        repo = (n.get("repository") or {})
        prs.append(PullRequest(
            title=n.get("title", ""),
            repo=repo.get("nameWithOwner", ""),
            org=repo.get("owner", {}).get("login", ""),
            created_at=n.get("createdAt", ""),
            merged_at=n.get("mergedAt"),
            closed_at=n.get("closedAt"),
            state=n.get("state", ""),
            additions=n.get("additions", 0),
            deletions=n.get("deletions", 0),
            changed_files=n.get("changedFiles", 0),
            url=n.get("url", ""),
        ))
    return prs


def _dedupe_prs(prs: list[PullRequest]) -> list[PullRequest]:
    seen = set()
    unique = []
    for pr in prs:
        if pr.url and pr.url in seen:
            continue
        if pr.url:
            seen.add(pr.url)
        unique.append(pr)
    return unique


def _fetch_prs_for_day(day: str) -> list[PullRequest]:
    """Fetch PRs authored by current user for a single UTC day (YYYY-MM-DD)."""
    username = _get_username()
    if not username:
        return []

    prs = []
    cursor = None
    query_range = f"{day}..{day}"

    while True:
        after = f', after: "{cursor}"' if cursor else ""
        query = f"""{{
  search(query: "is:pr author:{username} created:{query_range}", type: ISSUE, first: 100{after}) {{
    pageInfo {{ hasNextPage endCursor }}
    nodes {{
      ... on PullRequest {{
        title
        url
        createdAt
        mergedAt
        closedAt
        state
        repository {{ nameWithOwner owner {{ login }} }}
        additions
        deletions
        changedFiles
      }}
    }}
  }}
}}"""
        data = _run_gh(query)
        nodes = (data.get("data") or {}).get("search", {}).get("nodes", [])
        page_info = (data.get("data") or {}).get("search", {}).get("pageInfo", {})

        if not nodes:
            break

        prs.extend(_parse_nodes([n for n in nodes if n]))

        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")

    return prs


def _fetch_prs_since(since: str | None = None) -> list[PullRequest]:
    """Fetch PRs, optionally only those created after `since` (ISO date).

    Ordered DESC by creation date, stops paginating once we hit a PR older than `since`.
    """
    prs = []
    cursor = None
    page = 0

    while True:
        after = f', after: "{cursor}"' if cursor else ""
        query = f"""{{
  viewer {{
    pullRequests(first: 100, states: [OPEN, CLOSED, MERGED], orderBy: {{field: CREATED_AT, direction: DESC}}{after}) {{
      pageInfo {{ hasNextPage endCursor }}
      nodes {{
        title
        url
        createdAt
        mergedAt
        closedAt
        state
        repository {{ nameWithOwner owner {{ login }} }}
        additions
        deletions
        changedFiles
      }}
    }}
  }}
}}"""
        data = _run_gh(query)
        nodes = (data.get("data") or {}).get("viewer", {}).get("pullRequests", {}).get("nodes", [])
        page_info = (data.get("data") or {}).get("viewer", {}).get("pullRequests", {}).get("pageInfo", {})

        if not nodes:
            break

        batch = _parse_nodes(nodes)

        if since:
            # Stop when we hit PRs older than our cutoff
            for pr in batch:
                if pr.created_at > since:
                    prs.append(pr)
                else:
                    # We've reached cached territory, stop
                    return prs
        else:
            prs.extend(batch)

        page += 1
        if page % 5 == 0:
            print(f"  [github] fetched {len(prs)} PRs ({page} pages)...")

        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")

    return prs


def _pr_to_dict(pr: PullRequest) -> dict:
    return {
        "title": pr.title,
        "repo": pr.repo,
        "org": pr.org,
        "created_at": pr.created_at,
        "merged_at": pr.merged_at,
        "closed_at": pr.closed_at,
        "state": pr.state,
        "additions": pr.additions,
        "deletions": pr.deletions,
        "changed_files": pr.changed_files,
        "url": pr.url,
    }


def _dict_to_pr(d: dict) -> PullRequest:
    return PullRequest(**d)


def _save_cache(prs: list[PullRequest]):
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    # Find the newest PR date for watermark
    newest = ""
    for pr in prs:
        if pr.created_at > newest:
            newest = pr.created_at
    with open(CACHE_FILE, "w") as f:
        json.dump({
            "cached_at": datetime.now(timezone.utc).isoformat(),
            "newest_created_at": newest,
            "prs": [_pr_to_dict(pr) for pr in prs],
        }, f)


def _load_cache() -> tuple[list[PullRequest], str] | None:
    """Load cache. Returns (prs, newest_created_at) or None if no cache."""
    if not os.path.exists(CACHE_FILE):
        return None
    try:
        with open(CACHE_FILE) as f:
            data = json.load(f)
        prs = [_dict_to_pr(d) for d in data["prs"]]
        newest = data.get("newest_created_at", "")
        return prs, newest
    except Exception:
        return None


def _review_to_dict(r: Review) -> dict:
    return {
        "pr_title": r.pr_title,
        "pr_url": r.pr_url,
        "repo": r.repo,
        "org": r.org,
        "review_created_at": r.review_created_at,
        "state": r.state,
        "additions": r.additions,
        "deletions": r.deletions,
        "changed_files": r.changed_files,
    }


def _dict_to_review(d: dict) -> Review:
    return Review(**d)


def _get_username() -> str:
    result = subprocess.run(
        ["gh", "api", "user", "--jq", ".login"],
        capture_output=True, text=True, timeout=10,
    )
    return result.stdout.strip()


def _get_window_expected_count(username: str, date_range: str) -> int:
    """Quick check: how many PRs does the API say exist for this window?"""
    query = f"""{{ search(query: "is:pr reviewed-by:{username} created:{date_range}", type: ISSUE, first: 1) {{ issueCount }} }}"""
    data = _run_gh(query)
    return (data.get("data") or {}).get("search", {}).get("issueCount", 0)


def _fetch_reviews_window(username: str, date_range: str) -> tuple[list[Review], bool]:
    """Fetch all reviews for a single date range window.
    Returns (reviews, success). success=False if an API error occurred."""
    reviews = []
    cursor = None

    while True:
        after = f', after: "{cursor}"' if cursor else ""
        query = f"""{{
  search(query: "is:pr reviewed-by:{username} created:{date_range}", type: ISSUE, first: 100{after}) {{
    pageInfo {{ hasNextPage endCursor }}
    nodes {{
      ... on PullRequest {{
        title
        url
        createdAt
        repository {{ nameWithOwner owner {{ login }} }}
        additions
        deletions
        changedFiles
        reviews(author: "{username}", first: 10) {{
          nodes {{
            createdAt
            state
          }}
        }}
      }}
    }}
  }}
}}"""
        data = _run_gh(query)
        if not data:
            return reviews, False

        nodes = (data.get("data") or {}).get("search", {}).get("nodes", [])
        page_info = (data.get("data") or {}).get("search", {}).get("pageInfo", {})

        if not nodes:
            break

        for n in nodes:
            if not n:
                continue
            repo = (n.get("repository") or {})
            review_nodes = (n.get("reviews") or {}).get("nodes", [])
            for rv in review_nodes:
                reviews.append(Review(
                    pr_title=n.get("title", ""),
                    pr_url=n.get("url", ""),
                    repo=repo.get("nameWithOwner", ""),
                    org=repo.get("owner", {}).get("login", ""),
                    review_created_at=rv.get("createdAt", ""),
                    state=rv.get("state", ""),
                    additions=n.get("additions", 0),
                    deletions=n.get("deletions", 0),
                    changed_files=n.get("changedFiles", 0),
                ))

        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")

    return reviews, True


def _generate_half_year_windows(start_year: int, end_date: datetime) -> list[str]:
    """Generate half-year date range strings: 'YYYY-01-01..YYYY-06-30', 'YYYY-07-01..YYYY-12-31'."""
    windows = []
    end_year = end_date.year
    for year in range(start_year, end_year + 1):
        windows.append(f"{year}-01-01..{year}-06-30")
        windows.append(f"{year}-07-01..{year}-12-31")
    return windows


def _is_window_current(window: str) -> bool:
    """Check if a window contains today's date (still accumulating data)."""
    start, end = window.split("..")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return start <= today <= end


def _today_window() -> str:
    """Single-day window for today (UTC)."""
    d = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"{d}..{d}"


def _fetch_reviews_windowed(windows_to_fetch: list[str], cached_windows: dict) -> tuple[dict, list[Review]]:
    """Fetch reviews for specific windows. Returns updated window map and all new reviews."""
    username = _get_username()
    now = datetime.now(timezone.utc)
    new_reviews = []

    for window in windows_to_fetch:
        window_start = window.split("..")[0]
        if window_start > now.strftime("%Y-%m-%d"):
            continue

        reviews, success = _fetch_reviews_window(username, window)
        if not success:
            print(f"  [github] {window}: API error, skipping (will retry next run)")
            continue

        if reviews:
            print(f"  [github] {window}: {len(reviews)} reviews")
            new_reviews.extend(reviews)
            cached_windows[window] = len(reviews)
        else:
            # Got 0 — check if there should actually be data
            expected = _get_window_expected_count(username, window)
            if expected > 0:
                print(f"  [github] {window}: got 0 but API says {expected} PRs exist, marking for retry")
                # Don't mark as cached so it retries next run
            else:
                cached_windows[window] = 0

    return cached_windows, new_reviews


def _save_review_cache(reviews: list[Review], windows: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(REVIEW_CACHE_FILE, "w") as f:
        json.dump({
            "cached_at": datetime.now(timezone.utc).isoformat(),
            "windows": windows,  # {"2024-01-01..2024-06-30": 434, ...}
            "reviews": [_review_to_dict(r) for r in reviews],
        }, f)


def _load_review_cache() -> tuple[list[Review], dict] | None:
    """Returns (reviews, windows_dict) or None."""
    if not os.path.exists(REVIEW_CACHE_FILE):
        return None
    try:
        with open(REVIEW_CACHE_FILE) as f:
            data = json.load(f)
        reviews = [_dict_to_review(d) for d in data["reviews"]]
        windows = data.get("windows", {})
        return reviews, windows
    except Exception:
        return None


def _dedupe_reviews(reviews: list[Review]) -> list[Review]:
    seen = set()
    unique = []
    for r in reviews:
        key = (r.pr_url, r.review_created_at)
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


def _load_reviews() -> list[Review]:
    now = datetime.now(timezone.utc)
    all_windows = _generate_half_year_windows(github_history_start_year(), now)
    # Filter to non-future windows
    all_windows = [w for w in all_windows if w.split("..")[0] <= now.strftime("%Y-%m-%d")]

    cached = _load_review_cache()

    if cached is not None:
        cached_reviews, cached_windows = cached
        print(f"  [github] review cache has {len(cached_reviews)} reviews across {len(cached_windows)} windows")

        # Find windows that need fetching:
        # 1. Half-year windows not in cache at all (new or previously failed)
        # 2. Always fetch TODAY only (full-day TTL behavior)
        windows_to_fetch = []
        for w in all_windows:
            if w not in cached_windows:
                windows_to_fetch.append(w)

        today = _today_window()
        windows_to_fetch.append(today)

        if not windows_to_fetch:
            print(f"  [github] all windows cached, no fetch needed")
            return cached_reviews

        print(f"  [github] fetching {len(windows_to_fetch)} windows: {', '.join(windows_to_fetch)}")
        cached_windows, new_reviews = _fetch_reviews_windowed(windows_to_fetch, cached_windows)

        # Merge: keep cached reviews from windows we didn't re-fetch, add new ones
        refetched_windows = set(windows_to_fetch)
        kept = [r for r in cached_reviews if not _review_in_windows(r, refetched_windows)]
        all_reviews = _dedupe_reviews(kept + new_reviews)

        print(f"  [github] total: {len(all_reviews)} reviews")
        _save_review_cache(all_reviews, cached_windows)
        return all_reviews

    # First run
    print("  [github] no review cache found, fetching all reviews (half-year windows)...")
    cached_windows, all_reviews = _fetch_reviews_windowed(all_windows, {})
    all_reviews = _dedupe_reviews(all_reviews)
    print(f"  [github] fetched {len(all_reviews)} total unique reviews")
    _save_review_cache(all_reviews, cached_windows)
    return all_reviews


def _review_in_windows(review: Review, windows: set[str]) -> bool:
    """Check if a review's PR creation date falls within any of the given windows."""
    # We don't have PR created_at on the review, but we can check by review date
    for w in windows:
        start, end = w.split("..")
        # Reviews are tied to PR created date in the search, so approximate
        # by checking the review date against the window
        rd = review.review_created_at[:10] if review.review_created_at else ""
        if start <= rd <= end:
            return True
    return False


def load() -> GitHubPRResult:
    """Load GitHub PR data with incremental caching."""
    cached = _load_cache()

    if cached is not None:
        cached_prs, newest = cached
        print(f"  [github] cache has {len(cached_prs)} PRs (newest: {newest[:10] if newest else 'n/a'})")

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        newest_day = newest[:10] if newest else ""

        # Full-day TTL behavior:
        # - If newest cache day is today, only refresh today's slice.
        # - Otherwise, run incremental since newest to catch uncached days.
        if newest_day == today:
            print(f"  [github] refreshing today's PRs: {today}..{today}")
            today_prs = _fetch_prs_for_day(today)
            kept = [pr for pr in cached_prs if (pr.created_at[:10] if pr.created_at else "") != today]
            all_prs = _dedupe_prs(kept + today_prs)
            _save_cache(all_prs)
            reviews = _load_reviews()
            return GitHubPRResult(prs=all_prs, reviews=reviews, total=len(all_prs), source="incremental")

        # Fetch only new PRs since the newest cached one
        print(f"  [github] fetching new PRs since {newest[:10]}...")
        new_prs = _fetch_prs_since(newest)

        if new_prs:
            # Deduplicate by URL (in case of overlap at the boundary)
            existing_urls = {pr.url for pr in cached_prs}
            truly_new = [pr for pr in new_prs if pr.url not in existing_urls]
            print(f"  [github] found {len(truly_new)} new PRs")

            # Also refresh state of recently cached OPEN PRs (they may have been merged/closed)
            all_prs = truly_new + cached_prs
        else:
            print(f"  [github] no new PRs found")
            all_prs = cached_prs

        _save_cache(all_prs)
        reviews = _load_reviews()
        return GitHubPRResult(prs=all_prs, reviews=reviews, total=len(all_prs), source="incremental")

    # First run: fetch everything
    print("  [github] no cache found, fetching all PRs (this may take a while)...")
    prs = _fetch_prs_since(None)
    print(f"  [github] fetched {len(prs)} total PRs")
    _save_cache(prs)
    reviews = _load_reviews()
    return GitHubPRResult(prs=prs, reviews=reviews, total=len(prs), source="github-graphql")


def compute_stats(result: GitHubPRResult) -> dict:
    """Compute all PR statistics for the report."""
    prs = result.prs

    total = len(prs)
    merged = sum(1 for p in prs if p.state == "MERGED")
    open_count = sum(1 for p in prs if p.state == "OPEN")
    closed = sum(1 for p in prs if p.state == "CLOSED")

    # Per project (repo)
    per_project = {}
    for pr in prs:
        if pr.repo not in per_project:
            per_project[pr.repo] = {"total": 0, "merged": 0, "open": 0, "closed": 0}
        per_project[pr.repo]["total"] += 1
        if pr.state == "MERGED":
            per_project[pr.repo]["merged"] += 1
        elif pr.state == "OPEN":
            per_project[pr.repo]["open"] += 1
        else:
            per_project[pr.repo]["closed"] += 1

    # Per org
    per_org = {}
    for pr in prs:
        org = pr.org or "personal"
        if org not in per_org:
            per_org[org] = {"total": 0, "merged": 0, "dates": set()}
        per_org[org]["total"] += 1
        if pr.state == "MERGED":
            per_org[org]["merged"] += 1
            if pr.created_at:
                per_org[org]["dates"].add(pr.created_at[:10])

    # Compute working days vs non-working days per org
    today = datetime.now(timezone.utc).date()
    org_stats = {}
    for org, data in per_org.items():
        all_dates = sorted(data["dates"])
        if not all_dates:
            org_stats[org] = {
                "total": data["total"],
                "merged": data["merged"],
                "workday_prs": 0, "weekend_prs": 0,
                "working_days": 0, "weekend_days": 0,
                "avg_per_working_day": 0, "avg_per_weekend_day": 0,
            }
            continue

        first = datetime.strptime(all_dates[0], "%Y-%m-%d").date()
        # Use today as the end date (every day before today is complete)
        last = min(datetime.strptime(all_dates[-1], "%Y-%m-%d").date(), today)

        working_days = 0
        weekend_days = 0
        d = first
        while d <= last:
            if d.weekday() < 5:
                working_days += 1
            else:
                weekend_days += 1
            d += timedelta(days=1)

        # Count merged PRs created on workdays vs weekends
        workday_prs = 0
        weekend_prs = 0
        for pr in prs:
            if (pr.org or "personal") != org:
                continue
            if pr.state != "MERGED":
                continue
            if not pr.created_at:
                continue
            pr_date = datetime.strptime(pr.created_at[:10], "%Y-%m-%d").date()
            if pr_date.weekday() < 5:
                workday_prs += 1
            else:
                weekend_prs += 1

        avg_wd = workday_prs / working_days if working_days > 0 else 0
        avg_we = weekend_prs / weekend_days if weekend_days > 0 else 0
        org_stats[org] = {
            "total": data["total"],
            "merged": data["merged"],
            "workday_prs": workday_prs,
            "weekend_prs": weekend_prs,
            "working_days": working_days,
            "weekend_days": weekend_days,
            "avg_per_working_day": round(avg_wd, 2),
            "avg_per_weekend_day": round(avg_we, 2),
        }

    # Size stats (additions + deletions)
    sizes = sorted([pr.additions + pr.deletions for pr in prs])
    additions_list = sorted([pr.additions for pr in prs])
    deletions_list = sorted([pr.deletions for pr in prs])
    files_list = sorted([pr.changed_files for pr in prs])

    def percentile(arr, p):
        if not arr:
            return 0
        k = (len(arr) - 1) * (p / 100)
        f = int(k)
        c = min(f + 1, len(arr) - 1)
        d = k - f
        return arr[f] + d * (arr[c] - arr[f])

    size_stats = {
        "lines_changed": {
            "p25": round(percentile(sizes, 25)),
            "p50": round(percentile(sizes, 50)),
            "p75": round(percentile(sizes, 75)),
            "p90": round(percentile(sizes, 90)),
            "p95": round(percentile(sizes, 95)),
            "p99": round(percentile(sizes, 99)),
            "avg": round(sum(sizes) / len(sizes)) if sizes else 0,
            "max": max(sizes) if sizes else 0,
        },
        "additions": {
            "p50": round(percentile(additions_list, 50)),
            "p90": round(percentile(additions_list, 90)),
            "p95": round(percentile(additions_list, 95)),
            "avg": round(sum(additions_list) / len(additions_list)) if additions_list else 0,
        },
        "deletions": {
            "p50": round(percentile(deletions_list, 50)),
            "p90": round(percentile(deletions_list, 90)),
            "p95": round(percentile(deletions_list, 95)),
            "avg": round(sum(deletions_list) / len(deletions_list)) if deletions_list else 0,
        },
        "files_changed": {
            "p50": round(percentile(files_list, 50)),
            "p90": round(percentile(files_list, 90)),
            "p95": round(percentile(files_list, 95)),
            "avg": round(sum(files_list) / len(files_list)) if files_list else 0,
        },
    }

    # PRs over time (by month)
    by_month = {}
    for pr in prs:
        if not pr.created_at:
            continue
        month = pr.created_at[:7]
        if month not in by_month:
            by_month[month] = {"total": 0, "merged": 0, "open": 0, "closed": 0}
        by_month[month]["total"] += 1
        if pr.state == "MERGED":
            by_month[month]["merged"] += 1
        elif pr.state == "OPEN":
            by_month[month]["open"] += 1
        else:
            by_month[month]["closed"] += 1

    def _parse_iso(ts: str | None) -> datetime | None:
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return None

    merge_times = []
    for pr in prs:
        if pr.state != "MERGED":
            continue
        created_at = _parse_iso(pr.created_at)
        merged_at = _parse_iso(pr.merged_at)
        if not created_at or not merged_at:
            continue
        hours = (merged_at - created_at).total_seconds() / 3600
        if hours >= 0:
            merge_times.append(hours)

    merge_times.sort()
    merge_time_stats = {
        "avg": round(sum(merge_times) / len(merge_times)) if merge_times else 0,
        "p50": round(percentile(merge_times, 50)) if merge_times else 0,
        "p90": round(percentile(merge_times, 90)) if merge_times else 0,
    }

    return {
        "total": total,
        "merged": merged,
        "open": open_count,
        "closed": closed,
        "per_project": dict(sorted(per_project.items(), key=lambda x: x[1]["total"], reverse=True)),
        "per_org": org_stats,
        "size_stats": size_stats,
        "by_month": dict(sorted(by_month.items())),
        "merge_time_stats": merge_time_stats,
        "prs": [_pr_to_dict(pr) for pr in prs],
        "reviews": _compute_review_stats(result.reviews),
    }


def _compute_review_stats(reviews: list[Review]) -> dict:
    total = len(reviews)
    by_state = {}
    for r in reviews:
        by_state[r.state] = by_state.get(r.state, 0) + 1

    # Per org
    per_org = {}
    for r in reviews:
        org = r.org or "personal"
        if org not in per_org:
            per_org[org] = {"total": 0, "by_state": {}}
        per_org[org]["total"] += 1
        per_org[org]["by_state"][r.state] = per_org[org]["by_state"].get(r.state, 0) + 1

    # Per repo
    per_repo = {}
    for r in reviews:
        if r.repo not in per_repo:
            per_repo[r.repo] = {"total": 0}
        per_repo[r.repo]["total"] += 1

    # By month
    by_month = {}
    for r in reviews:
        if r.review_created_at:
            month = r.review_created_at[:7]
            by_month[month] = by_month.get(month, 0) + 1

    return {
        "total": total,
        "by_state": by_state,
        "per_org": dict(sorted(per_org.items(), key=lambda x: x[1]["total"], reverse=True)),
        "per_repo": dict(sorted(per_repo.items(), key=lambda x: x[1]["total"], reverse=True)),
        "by_month": dict(sorted(by_month.items())),
        "reviews": [_review_to_dict(r) for r in reviews],
    }
