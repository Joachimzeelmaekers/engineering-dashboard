"""Behavioral coverage for submitted-review completeness and safe cache refreshes."""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from engineering_dashboard.providers import github_prs


WINDOW = "2020-01-01..2020-06-30"
SUBMITTED = "2026-01-02T03:04:05Z"


def review_node(number, *, state="COMMENTED", submitted=SUBMITTED):
    return {"id": f"R{number}", "createdAt": "2020-01-02T00:00:00Z",
            "submittedAt": submitted, "state": state}


def connection(nodes, cursor=None):
    return {"nodes": nodes, "pageInfo": {"hasNextPage": cursor is not None, "endCursor": cursor}}


def pr_node(number, reviews=None, cursor=None):
    return {"id": f"PR{number}", "title": f"PR {number}",
            "url": f"https://github.com/org/repo/pull/{number}",
            "createdAt": "2020-01-01T00:00:00Z",
            "repository": {"nameWithOwner": "org/repo", "owner": {"login": "org"}},
            "additions": 7, "deletions": 2, "changedFiles": 1,
            "reviews": connection(reviews if reviews is not None else [review_node(number)], cursor)}


def search_page(nodes, count=None, cursor=None):
    return {"data": {"search": {"issueCount": len(nodes) if count is None else count,
                                **connection(nodes, cursor)}}}


class ReviewCollectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.cache = Path(temporary.name) / "reviews.json"
        for name, value in (("REVIEW_CACHE_FILE", str(self.cache)),
                            ("_get_username", lambda: "me"),
                            ("_generate_half_year_windows", lambda *args: [WINDOW])):
            mock = patch.object(github_prs, name, value)
            mock.start()
            self.addCleanup(mock.stop)

    def seed_cache(self, reviews):
        # Legacy rows deliberately lack IDs and PR creation dates.
        rows = [{"pr_title": f"PR {number}", "pr_url": pr_node(number)["url"],
                 "repo": "org/repo", "org": "org", "review_created_at": SUBMITTED,
                 "state": state, "additions": 1, "deletions": 0, "changed_files": 1}
                for number, state in reviews]
        self.cache.write_text(json.dumps({"reviews": rows, "windows": {WINDOW: len(rows)}}))
        return self.cache.read_bytes()

    def test_all_review_pages_use_submission_dates_and_stable_ids(self):
        first = [review_node(i) for i in range(100)]
        last = [review_node(100), review_node(101, state="DISMISSED"),
                review_node(102, state="PENDING", submitted=None), review_node(0)]
        responses = [search_page([pr_node(1, first, "more")]),
                     {"data": {"node": {"reviews": connection(last)}}}]
        with patch.object(github_prs, "_run_gh", side_effect=responses):
            reviews, complete = github_prs._fetch_reviews_window("me", WINDOW)
        self.assertTrue(complete)
        unique = github_prs._dedupe_reviews(reviews)
        self.assertEqual({r.review_id for r in unique}, {f"R{i}" for i in range(102)})
        self.assertEqual(len(unique), 102)
        self.assertEqual({r.review_created_at for r in unique}, {SUBMITTED})
        self.assertEqual({r.pr_created_at for r in unique}, {"2020-01-01T00:00:00Z"})
        self.assertEqual(next(r.state for r in unique if r.review_id == "R101"), "DISMISSED")

    def test_search_over_1000_is_split_and_every_matching_pr_is_counted(self):
        pages = [search_page([], count=1001)]
        for numbers in (list(range(500)), list(range(500, 1001))):
            for offset in range(0, len(numbers), 100):
                batch = numbers[offset:offset + 100]
                more = str(offset + 100) if offset + 100 < len(numbers) else None
                pages.append(search_page([pr_node(i) for i in batch], len(numbers), more))
        with patch.object(github_prs, "_run_gh", side_effect=pages):
            reviews, complete = github_prs._fetch_reviews_window("me", WINDOW)
        self.assertTrue(complete)
        self.assertEqual({r.review_id for r in reviews}, {f"R{i}" for i in range(1001)})
        self.assertEqual(len(reviews), 1001)

    def test_indivisible_oversized_window_warns_instead_of_claiming_complete(self):
        errors = io.StringIO()
        with redirect_stderr(errors), patch.object(github_prs, "_run_gh", return_value=search_page([], 1001)):
            reviews, complete = github_prs._fetch_reviews_window("me", "2020-01-01T00:00:00Z..2020-01-01T00:00:00Z")
        self.assertFalse(complete)
        self.assertEqual(reviews, [])
        self.assertIn("1000-result search limit", errors.getvalue())

    def test_cached_creation_window_is_refreshed_for_new_reviews_on_old_prs(self):
        self.seed_cache([(1, "APPROVED"), (2, "COMMENTED"), (3, "PENDING"), (4, "COMMENTED")])
        # PR 1 now has a new submitted review; PR 4 is accessible but no longer
        # has submitted reviews. PR 2 is absent from the API and must survive.
        fresh = pr_node(1, [review_node(10, state="CHANGES_REQUESTED"), review_node(11)])
        empty = pr_node(4, [])
        errors = io.StringIO()
        with redirect_stderr(errors), patch.object(github_prs, "_run_gh", return_value=search_page([fresh, empty])):
            reviews = github_prs._load_reviews()
        self.assertEqual([(r.pr_url, r.review_id) for r in reviews],
                         [(pr_node(1)["url"], "R10"), (pr_node(1)["url"], "R11"),
                          (pr_node(2)["url"], "")])
        self.assertIn("absent from the current API search", errors.getvalue())
        persisted = json.loads(self.cache.read_text())
        self.assertEqual(persisted["unrefreshed_pr_urls"], [pr_node(2)["url"]])
        self.assertEqual(len(persisted["reviews"]), 3)

    def test_failed_refresh_preserves_cache_byte_for_byte(self):
        original = self.seed_cache([(1, "APPROVED")])
        first = search_page([pr_node(1, [review_node(10)], "more")])
        partial = search_page([pr_node(2)])
        partial["errors"] = [{"message": "denied"}]
        cases = {"first page": [{}], "later review page": [first, {}],
                 "partial GraphQL response": [partial],
                 "missing search records": [search_page([], 1)],
                 "duplicate PR masks missing result": [search_page([pr_node(1), pr_node(1)], 2)],
                 "count changes during search": [search_page([pr_node(1)], 2, "next"), search_page([pr_node(2)], 3)],
                 "repeated review cursor": [first, {"data": {"node": {"reviews": connection([review_node(11)], "more")}}}]}
        for name, responses in cases.items():
            errors = io.StringIO()
            with self.subTest(name=name), redirect_stderr(errors), patch.object(github_prs, "_run_gh", side_effect=responses):
                reviews = github_prs._load_reviews()
            self.assertEqual([(r.pr_url, r.state) for r in reviews], [(pr_node(1)["url"], "APPROVED")])
            self.assertEqual(self.cache.read_bytes(), original)
            self.assertIn("stale and may be incomplete", errors.getvalue())

    def test_failed_first_run_does_not_save_partial_results_as_complete(self):
        first = search_page([pr_node(1)], count=2, cursor="more")
        with redirect_stderr(io.StringIO()), patch.object(github_prs, "_run_gh", side_effect=[first, {}]):
            reviews = github_prs._load_reviews()
        self.assertEqual([r.review_id for r in reviews], ["R1"])
        self.assertFalse(self.cache.exists())


if __name__ == "__main__":
    unittest.main()
