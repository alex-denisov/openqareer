"""Unit tests for gsc_client: input validation, request bodies, response shaping."""
import unittest

import gsc_client as gc


class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.ok = 200 <= status < 300

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.response


class SearchAnalyticsBody(unittest.TestCase):
    def test_builds_body_with_filters(self):
        body = gc.search_analytics_body(
            "2026-10-01", "2026-10-28", ["query", "page"], 500, 0,
            [{"dimension": "page", "operator": "contains", "expression": "/vacancies/"}],
            "web", "final")
        self.assertEqual(body["dimensions"], ["query", "page"])
        self.assertEqual(body["rowLimit"], 500)
        self.assertEqual(body["dimensionFilterGroups"][0]["filters"][0]["operator"], "contains")
        self.assertEqual(body["type"], "web")

    def test_rejects_bad_input(self):
        bad = [
            ("2026-13-01", "2026-10-28", ["query"], 10),
            ("2026-10-28", "2026-10-01", ["query"], 10),
            ("2026-10-01", "2026-10-28", ["keyword"], 10),
            ("2026-10-01", "2026-10-28", ["query"], 0),
            ("2026-10-01", "2026-10-28", ["query"], 25001),
        ]
        for start, end, dims, limit in bad:
            with self.subTest(start=start, end=end, dims=dims, limit=limit):
                with self.assertRaises(ValueError):
                    gc.search_analytics_body(start, end, dims, limit, 0, None, "web", "final")

    def test_rejects_unknown_filter_operator(self):
        with self.assertRaises(ValueError):
            gc.search_analytics_body("2026-10-01", "2026-10-02", ["page"], 10, 0,
                                     [{"dimension": "page", "operator": "like", "expression": "x"}],
                                     "web", "final")


class ShapeRows(unittest.TestCase):
    def test_flattens_keys_and_rounds(self):
        rows = gc.shape_rows(["query", "page"], [
            {"keys": ["вакансии", "https://openqareer.com/vacancies"], "clicks": 1,
             "impressions": 20, "ctr": 0.05, "position": 12.345}])
        self.assertEqual(rows, [{"query": "вакансии", "page": "https://openqareer.com/vacancies",
                                 "clicks": 1, "impressions": 20, "ctr": 0.05, "position": 12.3}])


class ApiCall(unittest.TestCase):
    def test_raises_readable_error(self):
        session = FakeSession(FakeResponse(403, {"error": {"status": "PERMISSION_DENIED",
                                                             "message": "User does not have access"}}))
        with self.assertRaises(gc.GscError) as ctx:
            gc.call(session, "GET", "https://example.test/x")
        self.assertIn("403", str(ctx.exception))
        self.assertIn("PERMISSION_DENIED", str(ctx.exception))

    def test_site_url_is_encoded(self):
        self.assertEqual(gc.site_path("https://openqareer.com/"),
                         "https%3A%2F%2Fopenqareer.com%2F")


class PageSpeedSummary(unittest.TestCase):
    def test_keeps_scores_and_core_metrics(self):
        raw = {"lighthouseResult": {
            "finalUrl": "https://openqareer.com/",
            "categories": {"performance": {"score": 0.87}, "seo": {"score": 1}},
            "audits": {"largest-contentful-paint": {"displayValue": "2.1 s", "numericValue": 2100},
                       "unused": {"displayValue": "x"}}},
            "loadingExperience": {"overall_category": "FAST"}}
        out = gc.summarize_pagespeed(raw)
        self.assertEqual(out["scores"], {"performance": 87, "seo": 100})
        self.assertEqual(out["metrics"]["largest-contentful-paint"], "2.1 s")
        self.assertNotIn("unused", out["metrics"])
        self.assertEqual(out["field_data"], "FAST")


if __name__ == "__main__":
    unittest.main()
