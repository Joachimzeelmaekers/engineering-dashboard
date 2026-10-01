"""Behavioral coverage for complete authored-PR refreshes and cache fallback."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from engineering_dashboard.providers import github_prs


def pr_node(number, *, created_at="2020-01-01T00:00:00Z", state="OPEN", additions=1):
    return {
        "title": f"PR {number}",
        "url": f"https://github.com/org/repo/pull/{number}",
        "createdAt": created_at,
        "mergedAt": "2026-01-01T00:00:00Z" if state == "MERGED" else None,
        "closedAt": "2026-01-01T00:00:00Z" if state != "OPEN" else None,
        "state": state,
        "repository": {"nameWithOwner": "org/repo", "owner": {"login": "org"}},
        "additions": additions,
        "deletions": 3,
        "changedFiles": 2,
    }


def pr_page(nodes, total, *, next_cursor=None):
    return {"data": {"viewer": {"pullRequests": {
        "nodes": nodes,
        "totalCount": total,
        "pageInfo": {"hasNextPage": next_cursor is not None, "endCursor": next_cursor},
    }}}}


class AuthoredPRCollectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.cache = Path(temporary.name) / "prs.json"
        cache_patch = patch.object(github_prs, "CACHE_FILE", str(self.cache))
        cache_patch.start()
        self.addCleanup(cache_patch.stop)
        reviews_patch = patch.object(github_prs, "_load_reviews", return_value=[])
        reviews_patch.start()
        self.addCleanup(reviews_patch.stop)

    def seed_cache(self, nodes):
        github_prs._save_cache(github_prs._parse_nodes(nodes))
        return self.cache.read_bytes()

    def test_refresh_recovers_missing_history_and_updates_states_and_sizes(self):
        self.seed_cache([pr_node(1), pr_node(2, state="CLOSED")])
        merged = pr_node(1, state="MERGED", additions=42)
        reopened = pr_node(2, state="OPEN", additions=8)
        # A third PR has the exact same creation timestamp as the old watermark.
        missing = pr_node(3)
        pages = [pr_page([merged, reopened], 3, next_cursor="page2"),
                 pr_page([reopened, missing], 3)]
        with patch.object(github_prs, "_run_gh", side_effect=pages):
            result = github_prs.load()
        by_url = {pr.url: pr for pr in result.prs}
        self.assertEqual(result.total, 3)
        self.assertEqual(set(by_url), {merged["url"], reopened["url"], missing["url"]})
        self.assertEqual((by_url[merged["url"]].state, by_url[merged["url"]].additions),
                         ("MERGED", 42))
        self.assertEqual((by_url[reopened["url"]].state, by_url[reopened["url"]].additions),
                         ("OPEN", 8))
        self.assertEqual(by_url[merged["url"]].merged_at, merged["mergedAt"])
        self.assertEqual(by_url[reopened["url"]].closed_at, None)
        persisted = json.loads(self.cache.read_text())["prs"]
        self.assertEqual({pr["url"] for pr in persisted}, set(by_url))
        self.assertEqual(len(persisted), 3)

    def test_failed_or_incomplete_refresh_preserves_cache_byte_for_byte(self):
        today = github_prs.datetime.now(github_prs.timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
        original = self.seed_cache([pr_node(1, created_at=today)])
        initial_page = pr_page([pr_node(2)], 2, next_cursor="page2")
        partial_error = pr_page([pr_node(3)], 2)
        partial_error["errors"] = [{"message": "permission denied"}]
        cases = {
            "first page failure": [{}],
            "later page failure": [initial_page, {}],
            "partial GraphQL response": [initial_page, partial_error],
            "missing final records": [pr_page([pr_node(2)], 2)],
            "repeated cursor": [initial_page, pr_page([pr_node(3)], 2, next_cursor="page2")],
            "changing total": [initial_page, pr_page([pr_node(3)], 3)],
        }
        for name, pages in cases.items():
            with self.subTest(name=name), patch.object(github_prs, "_run_gh", side_effect=pages):
                result = github_prs.load()
            self.assertEqual(result.source, "cache-fallback")
            self.assertEqual([pr.url for pr in result.prs], [pr_node(1)["url"]])
            self.assertEqual(self.cache.read_bytes(), original)

    def test_failure_without_cache_does_not_publish_partial_history(self):
        pages = [pr_page([pr_node(1)], 2, next_cursor="page2"), {}]
        with patch.object(github_prs, "_run_gh", side_effect=pages):
            with self.assertRaises(github_prs.GitHubPRFetchError):
                github_prs.load()
        self.assertFalse(self.cache.exists())

    def test_inaccessible_cached_history_is_retained_without_overriding_fresh_records(self):
        for visible in ([], [pr_node(1, state="MERGED", additions=42)]):
            with self.subTest(visible=len(visible)):
                self.seed_cache([pr_node(1), pr_node(2)])
                with patch.object(github_prs, "_run_gh", return_value=pr_page(visible, len(visible))):
                    result = github_prs.load()
                by_url = {pr.url: pr for pr in result.prs}
                self.assertEqual(result.total, 2)
                self.assertEqual(set(by_url), {pr_node(1)["url"], pr_node(2)["url"]})
                self.assertEqual(result.source, "github-graphql-with-cached-history")
                self.assertEqual(by_url[pr_node(2)["url"]].state, "OPEN")
                expected = ("MERGED", 42) if visible else ("OPEN", 1)
                self.assertEqual(
                    (by_url[pr_node(1)["url"]].state, by_url[pr_node(1)["url"]].additions),
                    expected,
                )
                self.assertEqual(len(json.loads(self.cache.read_text())["prs"]), 2)


if __name__ == "__main__":
    unittest.main()
