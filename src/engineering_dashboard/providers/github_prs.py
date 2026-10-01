"""GitHub Pull Request statistics provider.

Fetches all accessible PRs authored by the authenticated user via GraphQL.
Refreshes the complete authored-PR connection on each run. Caches are only
replaced after a complete fetch; failed refreshes retain the previous data.
Previously cached PRs no longer accessible are retained with a warning.
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
    review_id: str = ""
    pr_created_at: str = ""


@dataclass
class GitHubPRResult:
    prs: list  # list[PullRequest]
    reviews: list  # list[Review]
    total: int
    source: str = "github-graphql"


CACHE_FILE = os.path.join(DATA_DIR, "cache_github_prs.json")
REVIEW_CACHE_FILE = os.path.join(DATA_DIR, "cache_github_reviews.json")


def _run_gh(query: str) -> dict:
    """Run a GraphQL query via gh CLI, rejecting partial/error responses."""
    try:
        result = subprocess.run(
            ["gh", "api", "graphql", "-f", f"query={query}"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"  [github] gh api error: {result.stderr.strip()}", file=sys.stderr)
            return {}
        data = json.loads(result.stdout)
        if not isinstance(data, dict) or data.get("errors"):
            print(f"  [github] GraphQL error: {data}", file=sys.stderr)
            return {}
        return data
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        print(f"  [github] gh api error: {exc}", file=sys.stderr)
        return {}


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


class GitHubPRFetchError(RuntimeError):
    """The authored-PR connection could not be fetched completely."""


def _fetch_prs() -> list[PullRequest]:
    """Fetch every accessible authored PR, without creation-date cutoffs."""
    prs = []
    cursor = None
    seen_cursors = set()
    expected_count = None
    page = 0

    while True:
        after = f", after: {json.dumps(cursor)}" if cursor else ""
        query = f"""{{
  viewer {{
    pullRequests(first: 100, states: [OPEN, CLOSED, MERGED], orderBy: {{field: CREATED_AT, direction: DESC}}{after}) {{
      totalCount
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
        connection = ((data.get("data") or {}).get("viewer") or {}).get("pullRequests")
        if data.get("errors") or not isinstance(connection, dict):
            raise GitHubPRFetchError("missing or failed authored-PR connection")
        nodes = connection.get("nodes")
        page_info = connection.get("pageInfo")
        count = connection.get("totalCount")
        if (
            not isinstance(nodes, list)
            or any(not isinstance(node, dict) or not node.get("url") for node in nodes)
            or not isinstance(page_info, dict)
            or not isinstance(page_info.get("hasNextPage"), bool)
            or not isinstance(count, int)
            or count < 0
        ):
            raise GitHubPRFetchError("incomplete authored-PR page")
        if expected_count is None:
            expected_count = count
        elif count != expected_count:
            raise GitHubPRFetchError("authored-PR count changed during pagination")

        prs.extend(_parse_nodes(nodes))
        page += 1
        if page % 5 == 0:
            print(f"  [github] fetched {len(prs)} PRs ({page} pages)...")

        if not page_info["hasNextPage"]:
            break
        cursor = page_info.get("endCursor")
        if not nodes or not isinstance(cursor, str) or not cursor or cursor in seen_cursors:
            raise GitHubPRFetchError("authored-PR pagination did not advance")
        seen_cursors.add(cursor)

    prs = _dedupe_prs(prs)
    if len(prs) != expected_count:
        raise GitHubPRFetchError(
            f"incomplete authored-PR fetch: received {len(prs)} of {expected_count}"
        )
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
    with open(CACHE_FILE, "w") as f:
        json.dump({
            "cached_at": datetime.now(timezone.utc).isoformat(),
            "prs": [_pr_to_dict(pr) for pr in prs],
        }, f)


def _load_cache() -> list[PullRequest] | None:
    """Load cached records for fallback, never as proof of completeness."""
    if not os.path.exists(CACHE_FILE):
        return None
    try:
        with open(CACHE_FILE) as f:
            data = json.load(f)
        return _dedupe_prs([_dict_to_pr(d) for d in data["prs"]])
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
        "review_id": r.review_id,
        "pr_created_at": r.pr_created_at,
    }


def _dict_to_review(d: dict) -> Review:
    return Review(**d)


def _get_username() -> str:
    result = subprocess.run(
        ["gh", "api", "user", "--jq", ".login"],
        capture_output=True, text=True, timeout=10,
    )
    return result.stdout.strip()


def _review_query(query: str) -> dict | None:
    """Reject partial GraphQL responses instead of certifying a truncated refresh."""
    try:
        response = _run_gh(query)
    except (subprocess.SubprocessError, OSError, ValueError) as exc:
        print(f"  [github] review query failed: {exc}", file=sys.stderr)
        return None
    if not response or response.get("errors") or not response.get("data"):
        print("  [github] review query failed or returned partial data", file=sys.stderr)
        return None
    return response["data"]


def _fetch_pr_reviews(username: str, pr: dict) -> tuple[list[Review], bool]:
    """Follow the review connection independently for each matching PR."""
    reviews = []
    connection = pr.get("reviews")
    seen_cursors = set()
    while True:
        if not isinstance(connection, dict):
            return reviews, False
        nodes = connection.get("nodes")
        page = connection.get("pageInfo")
        if not isinstance(nodes, list) or not isinstance(page, dict) or "hasNextPage" not in page:
            return reviews, False
        for node in nodes:
            if not node or not node.get("id"):
                return reviews, False
            # Drafts have no submittedAt and must not count as completed reviews.
            if node.get("state") == "PENDING" or not node.get("submittedAt"):
                continue
            repo = pr.get("repository") or {}
            reviews.append(Review(
                pr_title=pr.get("title", ""),
                pr_url=pr.get("url", ""),
                repo=repo.get("nameWithOwner", ""),
                org=(repo.get("owner") or {}).get("login", ""),
                review_created_at=node["submittedAt"],
                state=node.get("state", ""),
                additions=pr.get("additions", 0),
                deletions=pr.get("deletions", 0),
                changed_files=pr.get("changedFiles", 0),
                review_id=node["id"],
                pr_created_at=pr.get("createdAt", ""),
            ))
        if not page["hasNextPage"]:
            return reviews, True
        cursor = page.get("endCursor")
        if not nodes or not cursor or cursor in seen_cursors or not pr.get("id"):
            return reviews, False
        seen_cursors.add(cursor)
        data = _review_query(f"""{{
  node(id: {json.dumps(pr["id"])}) {{
    ... on PullRequest {{
      reviews(author: {json.dumps(username)}, first: 100, after: {json.dumps(cursor)}) {{
        nodes {{ id submittedAt state }}
        pageInfo {{ hasNextPage endCursor }}
      }}
    }}
  }}
}}""")
        if data is None:
            return reviews, False
        connection = (data.get("node") or {}).get("reviews")


def _split_review_window(date_range: str) -> tuple[str, str] | None:
    """Split inclusive creation windows down to GitHub's second precision."""
    start_text, end_text = date_range.split("..")
    start = datetime.fromisoformat(start_text.replace("Z", "+00:00"))
    end = datetime.fromisoformat(end_text.replace("Z", "+00:00"))
    if len(start_text) == 10:
        start = start.replace(tzinfo=timezone.utc)
    if len(end_text) == 10:
        end = end.replace(tzinfo=timezone.utc) + timedelta(days=1, seconds=-1)
    seconds = int((end - start).total_seconds())
    if seconds <= 0:
        return None
    middle = start + timedelta(seconds=seconds // 2)
    left_start = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    left_end = middle.strftime("%Y-%m-%dT%H:%M:%SZ")
    right_start = (middle + timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    right_end = end.strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"{left_start}..{left_end}", f"{right_start}..{right_end}"


def _fetch_reviews_window(
    username: str, date_range: str, fetched_pr_urls: set[str] | None = None,
) -> tuple[list[Review], bool]:
    """Fetch all matching PRs and submitted reviews, detecting search truncation."""
    reviews = []
    cursor = None
    seen_cursors = set()
    seen_pr_urls = set()
    expected = None
    fetched_prs = 0
    while True:
        after = f", after: {json.dumps(cursor)}" if cursor else ""
        search = json.dumps(f"is:pr reviewed-by:{username} created:{date_range}")
        data = _review_query(f"""{{
  search(query: {search}, type: ISSUE, first: 100{after}) {{
    issueCount
    pageInfo {{ hasNextPage endCursor }}
    nodes {{
      ... on PullRequest {{
        id title url createdAt
        repository {{ nameWithOwner owner {{ login }} }}
        additions deletions changedFiles
        reviews(author: {json.dumps(username)}, first: 100) {{
          nodes {{ id submittedAt state }}
          pageInfo {{ hasNextPage endCursor }}
        }}
      }}
    }}
  }}
}}""")
        if data is None:
            return reviews, False
        result = data.get("search") or {}
        count = result.get("issueCount")
        nodes = result.get("nodes")
        page = result.get("pageInfo")
        if not isinstance(count, int) or not isinstance(nodes, list) or not isinstance(page, dict) or "hasNextPage" not in page:
            return reviews, False
        if expected is None:
            expected = count
            if expected > 1000:
                split = _split_review_window(date_range)
                if split is None:
                    print(f"  [github] incomplete reviews: {date_range} has {expected} PRs, exceeding the 1000-result search limit at one-second precision", file=sys.stderr)
                    return [], False
                left, left_ok = _fetch_reviews_window(username, split[0], fetched_pr_urls)
                right, right_ok = _fetch_reviews_window(username, split[1], fetched_pr_urls)
                return left + right, left_ok and right_ok
        elif count != expected:
            print(f"  [github] incomplete reviews: {date_range} matching PR count changed during pagination", file=sys.stderr)
            return reviews, False
        for pr in nodes:
            if not pr or not pr.get("url"):
                return reviews, False
            if pr["url"] in seen_pr_urls:
                continue
            pr_reviews, success = _fetch_pr_reviews(username, pr)
            if not success:
                return reviews, False
            seen_pr_urls.add(pr["url"])
            fetched_prs += 1
            if fetched_pr_urls is not None:
                fetched_pr_urls.add(pr["url"])
            reviews.extend(pr_reviews)
        if not page["hasNextPage"]:
            if fetched_prs != expected:
                print(f"  [github] incomplete reviews: {date_range} returned {fetched_prs} of {expected} matching PRs", file=sys.stderr)
                return reviews, False
            return reviews, True
        cursor = page.get("endCursor")
        if not nodes or not cursor or cursor in seen_cursors or fetched_prs >= 1000:
            return reviews, False
        seen_cursors.add(cursor)


def _generate_half_year_windows(start_year: int, end_date: datetime) -> list[str]:
    """Generate half-year date range strings: 'YYYY-01-01..YYYY-06-30', 'YYYY-07-01..YYYY-12-31'."""
    windows = []
    end_year = end_date.year
    for year in range(start_year, end_year + 1):
        windows.append(f"{year}-01-01..{year}-06-30")
        windows.append(f"{year}-07-01..{year}-12-31")
    return windows


def _fetch_reviews_windowed(windows_to_fetch: list[str]) -> tuple[dict, list[Review], bool, set[str]]:
    """Refresh all requested creation windows; record only completed windows."""
    try:
        username = _get_username()
    except (subprocess.SubprocessError, OSError) as exc:
        print(f"  [github] cannot identify review author: {exc}", file=sys.stderr)
        return {}, [], False, set()
    if not username:
        print("  [github] cannot identify review author", file=sys.stderr)
        return {}, [], False, set()
    windows = {}
    reviews = []
    complete = True
    fetched_pr_urls = set()
    for window in windows_to_fetch:
        fetched, success = _fetch_reviews_window(username, window, fetched_pr_urls)
        reviews.extend(fetched)
        if not success:
            print(f"  [github] {window}: incomplete review fetch; will retry next run", file=sys.stderr)
            complete = False
            continue
        windows[window] = len(fetched)
        print(f"  [github] {window}: {len(fetched)} reviews")
    return windows, reviews, complete, fetched_pr_urls


def _save_review_cache(reviews: list[Review], windows: dict, unrefreshed_pr_urls: set[str]):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(REVIEW_CACHE_FILE, "w") as f:
        json.dump({
            "cached_at": datetime.now(timezone.utc).isoformat(),
            "windows": windows,  # {"2024-01-01..2024-06-30": 434, ...}
            "accessible_complete": True,
            "unrefreshed_pr_urls": sorted(unrefreshed_pr_urls),
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
    for review in reviews:
        # Legacy caches have no IDs: preserve their rows until a complete refresh
        # replaces them, rather than guessing identity from a shared timestamp.
        if review.state == "PENDING":
            continue
        if review.review_id:
            if review.review_id in seen:
                continue
            seen.add(review.review_id)
        unique.append(review)
    return unique


def _load_reviews() -> list[Review]:
    now = datetime.now(timezone.utc)
    all_windows = _generate_half_year_windows(github_history_start_year(), now)
    all_windows = [w for w in all_windows if w.split("..")[0] <= now.strftime("%Y-%m-%d")]
    cached = _load_review_cache()
    print(f"  [github] refreshing reviews across {len(all_windows)} PR-creation windows")
    windows, fetched, complete, fetched_pr_urls = _fetch_reviews_windowed(all_windows)
    if not complete:
        if cached is not None:
            print("  [github] WARNING: review refresh incomplete; preserving cache. Reported review totals are stale and may be incomplete.", file=sys.stderr)
            return _dedupe_reviews(cached[0])
        print("  [github] WARNING: review refresh incomplete; reported totals are partial and no complete cache was saved.", file=sys.stderr)
        return _dedupe_reviews(fetched)
    # Missing search results can mean lost access. Replace only PRs actually
    # fetched, including those whose submitted-review connection is now empty.
    retained = [r for r in (cached[0] if cached else []) if r.pr_url not in fetched_pr_urls and r.state != "PENDING"]
    unrefreshed = {r.pr_url for r in retained}
    if unrefreshed:
        print(f"  [github] WARNING: retaining cached reviews on {len(unrefreshed)} PRs absent from the current API search; this history cannot be refreshed and may be incomplete.", file=sys.stderr)
    reviews = _dedupe_reviews(fetched + retained)
    _save_review_cache(reviews, windows, unrefreshed)
    print(f"  [github] {len(reviews)} submitted reviews ({len(fetched)} fetched, {len(retained)} cached historical rows retained)")
    return reviews


def load() -> GitHubPRResult:
    """Refresh all authored PRs, retaining cached data if the refresh fails."""
    cached = _load_cache()
    print("  [github] refreshing all authored PRs...")
    source = "github-graphql"
    try:
        prs = _fetch_prs()
    except GitHubPRFetchError as exc:
        if cached is None:
            raise
        print(
            f"  [github] PR refresh incomplete ({exc}); using {len(cached)} "
            "cached PRs without updating the cache",
            file=sys.stderr,
        )
        prs = cached
        source = "cache-fallback"
    else:
        print(f"  [github] fetched {len(prs)} total unique PRs")
        fresh_urls = {pr.url for pr in prs}
        inaccessible = [pr for pr in (cached or []) if pr.url not in fresh_urls]
        if inaccessible:
            print(
                f"  [github] retaining {len(inaccessible)} cached PRs absent from "
                "the accessible API results; their states and sizes could not be refreshed",
                file=sys.stderr,
            )
            prs.extend(inaccessible)
            source = "github-graphql-with-cached-history"
        _save_cache(prs)

    reviews = _load_reviews()
    return GitHubPRResult(prs=prs, reviews=reviews, total=len(prs), source=source)


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
