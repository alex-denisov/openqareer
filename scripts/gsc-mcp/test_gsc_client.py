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
    def test_error_keeps_status_code(self):
        session = FakeSession(FakeResponse(404, {"error": {"status": "NOT_FOUND"}}))
        with self.assertRaises(gc.GscError) as ctx:
            gc.call(session, "GET", "https://example.test/x")
        self.assertEqual(ctx.exception.status, 404)

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


SITE = "https://openqareer.com/"
JOB = "https://openqareer.com/vacancies/job/qa-engineer-at-acme-abc123"
MICRODATA = '<article itemscope itemtype="https://schema.org/JobPosting"><h1>QA</h1></article>'
JSONLD = '<script type="application/ld+json">{"@type": "JobPosting", "title": "QA"}</script>'


class JobPostingDetection(unittest.TestCase):
    def test_finds_microdata_and_json_ld(self):
        self.assertTrue(gc.has_job_posting(MICRODATA))
        self.assertTrue(gc.has_job_posting(JSONLD))

    def test_breadcrumbs_only_is_not_a_posting(self):
        self.assertFalse(gc.has_job_posting('{"@type":"BreadcrumbList"}'))


class NotificationGuard(unittest.TestCase):
    def test_updated_needs_live_posting(self):
        gc.check_notification(JOB, "URL_UPDATED", SITE, 200, MICRODATA)
        for status, html in [(200, '{"@type":"BreadcrumbList"}'), (410, MICRODATA), (301, MICRODATA)]:
            with self.subTest(status=status):
                with self.assertRaises(ValueError):
                    gc.check_notification(JOB, "URL_UPDATED", SITE, status, html)

    def test_deleted_needs_gone_page(self):
        gc.check_notification(JOB, "URL_DELETED", SITE, 410, "")
        gc.check_notification(JOB, "URL_DELETED", SITE, 404, "")
        with self.assertRaises(ValueError):
            gc.check_notification(JOB, "URL_DELETED", SITE, 200, MICRODATA)

    def test_rejects_foreign_url_and_unknown_type(self):
        for foreign in ["https://example.com/job", "https://openqareer.com.evil.tld/job",
                        "http://openqareer.com/vacancies/job/x"]:
            with self.subTest(foreign=foreign):
                with self.assertRaises(ValueError):
                    gc.check_notification(foreign, "URL_UPDATED", SITE, 200, MICRODATA)
        with self.assertRaises(ValueError):
            gc.check_notification(JOB, "URL_REFRESH", SITE, 200, MICRODATA)

    def test_batch_size_is_capped(self):
        gc.check_batch([JOB] * gc.MAX_NOTIFY)
        with self.assertRaises(ValueError):
            gc.check_batch([JOB] * (gc.MAX_NOTIFY + 1))
        with self.assertRaises(ValueError):
            gc.check_batch([])


class SitemapGuard(unittest.TestCase):
    def test_accepts_own_xml_only(self):
        self.assertEqual(gc.check_sitemap(SITE, "https://openqareer.com/sitemap.xml"),
                         "https%3A%2F%2Fopenqareer.com%2Fsitemap.xml")
        for bad in ["https://example.com/sitemap.xml", "https://openqareer.com/vacancies"]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    gc.check_sitemap(SITE, bad)


if __name__ == "__main__":
    unittest.main()
