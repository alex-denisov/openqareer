import json
import hashlib
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from cli import (
    FULL_COLUMNS, approve_candidate, apply_approved, backoff_delay, benchmark_synthetic,
    candidate_hash, claim_jobs, enqueue_tasks, ensure_private_external_path, exact_primary_page_blocks, init_state,
    import_packet, is_actual_challenge, is_direct_careers_portal, make_approved_manifest, make_report,
    open_state, record_job, reconcile_expected, run_corporate_jobs, safe_public_target, sha256_value, source_cache_lookup,
    parse_linkedin_company_id, parse_linkedin_employee_cta_id, extract_raw_rendered_links,
    source_specific_raw_text, extract_corporate_observation,
    source_outcome, validate_candidate, validate_full_baseline, validate_rendered_cta, wrapped_transport_status,
    normalize_packet_evidence,
    public_index_import_root_batches, export_public_index_batch, public_index_import_capture,
    verify_public_index_manifest_file,
)


def full_row(key="acme", name="Acme Systems"):
    return {
        "company_key": key, "company_name": name,
        "website_url": "https://old.acme.example", "careers_url": "https://old.acme.example/careers",
        "linkedin_url": None, "linkedin_org_id": None, "source_type": "corporate_portal",
        "ats_provider": None, "ats_slug": None, "status": "active", "geo": None, "industry": None,
        "domain_group": None, "notes": "private note", "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }


def good_evidence(**overrides):
    evidence = {
        "source_url": "https://acme.example/about",
        "excerpt": "Acme Systems builds industrial scheduling software for regional manufacturers.",
        "source_access": {"status": "content_observed", "method": "cached_primary_page"},
        "identity": {"observed_company_name": "Acme Systems", "business_context": "Industrial scheduling software for regional manufacturers."},
    }
    evidence.update(overrides)
    return evidence


class EvidenceTests(unittest.TestCase):
    def test_error_page_does_not_borrow_next_page_cta_with_inline_separator(self):
        raw = "Source: https://www.linkedin.com/company/wrong/ turn1view0\nTitle: InternalError" + "-" * 80 + "Source: https://www.linkedin.com/company/acme/ turn2view0\nTitle: Acme Systems | LinkedIn\n[12] href=https://www.linkedin.com/company/123456/employees/\n"
        blocks = exact_primary_page_blocks(raw)
        self.assertEqual(len(blocks), 2)
        self.assertIn("InternalError", blocks[0])
        with self.assertRaisesRegex(ValueError, "source_page_not_identity_verified"):
            validate_rendered_cta(rendered_ref="turn1view0", link_ref="turn1view0", link_id=12,
                                  source_url="https://www.linkedin.com/company/wrong/", page_title="InternalError", raw_source_block=blocks[0])
        found = validate_rendered_cta(rendered_ref="turn2view0", link_ref="turn2view0", link_id=12,
                                      source_url="https://www.linkedin.com/company/acme/", page_title="Acme Systems", raw_source_block=blocks[1])
        self.assertEqual(found["linkedin_org_id"], "123456")
        with self.assertRaisesRegex(ValueError, "link_id_and_href_not_present"):
            validate_rendered_cta(rendered_ref="turn1view0", link_ref="turn1view0", link_id=12,
                                  source_url="https://www.linkedin.com/company/wrong/", page_title="Acme Systems", raw_source_block=blocks[0])

    def test_stale_source_ref_and_link_id_are_rejected(self):
        raw = "Source: https://www.linkedin.com/company/acme/ turn2view0\n[12] href=https://www.linkedin.com/company/123456/employees/"
        with self.assertRaisesRegex(ValueError, "stale_ref_link_id_pair"):
            validate_rendered_cta(rendered_ref="turn2view0", link_ref="turn1view0", link_id=12,
                                  source_url="https://www.linkedin.com/company/acme/", page_title="Acme Systems", raw_source_block=raw)
        with self.assertRaisesRegex(ValueError, "source_reference_not_present"):
            validate_rendered_cta(rendered_ref="turn3view0", link_ref="turn3view0", link_id=12,
                                  source_url="https://www.linkedin.com/company/acme/", page_title="Acme Systems", raw_source_block=raw)

    def test_403_cannot_verify_numeric_id_and_robots_is_terminal(self):
        row = full_row()
        evidence = good_evidence(http_status=403, published_company_href="https://www.linkedin.com/company/123456/")
        status, reason, _ = validate_candidate("linkedin_org_id", "123456", evidence, row)
        self.assertEqual((status, reason), ("exception", "source_not_opened_successfully"))
        self.assertEqual(source_outcome("linkedin", 403, {"Retry-After": "90"})[0], "policy_denied")
        self.assertEqual(source_outcome("corporate", 403, {}, "Fetch denied by robots.txt")[1]["reason"], "robots_policy_denial")

    def test_official_published_numeric_href_survives_unknown_destination_state(self):
        evidence = good_evidence(
            source_url="https://acme.example/about",
            published_company_href="https://www.linkedin.com/company/123456/",
            source_role="official_corporate_site",
            destination_access_status="policy_denied",
        )
        status, reason, confidence = validate_candidate("linkedin_org_id", "123456", evidence, full_row())
        self.assertEqual((status, reason), ("valid_pending_review", None))
        self.assertEqual(confidence, "medium")

    def test_company_name_and_reassigned_domain_mismatch_go_to_exception(self):
        wrong_name = good_evidence(identity={"observed_company_name": "Acme Portugal Modular", "business_context": "A different business."})
        self.assertEqual(validate_candidate("website_url", "https://other.example", wrong_name, full_row())[1], "company_name_identity_mismatch")
        wrong_domain = good_evidence(identity={"observed_company_name": "Acme Systems", "business_context": "Industrial software.", "official_domain_match": False})
        self.assertEqual(validate_candidate("website_url", "https://other.example", wrong_domain, full_row())[1], "ambiguous_company_identity")

    def test_careers_route_rejects_narrow_category_page(self):
        self.assertFalse(is_direct_careers_portal("https://acme.example/careers/career-types/tech"))
        self.assertTrue(is_direct_careers_portal("https://acme.example/careers"))
        self.assertFalse(is_direct_careers_portal("https://evilgreenhouse.io.attacker/acme"))
        self.assertFalse(is_direct_careers_portal("https://acme.example/us/careers"))
        self.assertTrue(is_direct_careers_portal("https://jobs.greenhouse.io/acme"))
        self.assertFalse(is_direct_careers_portal("https://greenhouse.io"))
        self.assertFalse(is_direct_careers_portal("https://workday.com"))
        self.assertTrue(is_direct_careers_portal("https://appquantum.pinpointhq.com/"))
        status, reason, _ = validate_candidate("careers_url", "https://acme.example/careers/career-types/tech", good_evidence(), full_row())
        self.assertEqual((status, reason), ("exception", "narrow_or_unverified_careers_subpage"))
        status, reason, _ = validate_candidate("careers_url", "https://acme.example/careers", good_evidence(careers_scope="companywide_general_jobs", careers_scope_excerpt="Companywide open roles across all teams."), full_row())
        self.assertEqual((status, reason), ("valid_pending_review", None))
        self.assertEqual(validate_candidate("careers_url", "https://acme.example/careers", good_evidence(), full_row())[1], "careers_scope_unverified")

    def test_signup_security_label_is_not_challenge_but_real_checkpoint_is(self):
        self.assertFalse(is_actual_challenge(200, "https://www.linkedin.com/signup/", "Security verification", "Security verification"))
        self.assertTrue(is_actual_challenge(403, "https://www.linkedin.com/signup/", "Security verification", "Try again"))
        self.assertTrue(is_actual_challenge(200, "https://example.com/checkpoint", "Verify you are human", "captcha"))

    def test_raw_source_block_selection_does_not_bleed_429_across_pages(self):
        raw = "Source: https://acme.example/about turn-a\nAcme systems content" + "-" * 80 + "Source: https://other.example/jobs turn-b\nFailed to fetch (429) Too Many Requests"
        selected = source_specific_raw_text(raw, "https://acme.example/about", "turn-a")
        self.assertIn("Acme systems", selected)
        self.assertNotIn("429", selected)
        self.assertEqual(source_specific_raw_text(raw, "https://missing.example", "turn-missing"), "")

    def test_html_anchor_text_does_not_absorb_following_page_copy(self):
        observation = extract_corporate_observation("https://acme.example/about", 200,
            b'<a href="/product">Product</a> careers jobs <a href="/careers">Careers</a>')
        self.assertEqual(observation["career_links"], [{"href": "https://acme.example/careers", "text": "Careers"}])

    def test_wrapped_429_is_deferred_not_treated_as_page_content(self):
        evidence = good_evidence(excerpt="Failed to fetch https://acme.example/jobs (429) Too Many Requests")
        self.assertEqual(wrapped_transport_status(evidence), 429)
        status, reason, _ = validate_candidate("website_url", "https://acme.example", evidence, full_row())
        self.assertEqual((status, reason), ("deferred_cooldown", "wrapped_http_429_retry_after_required"))

    def test_cta_href_must_be_raw_and_resolve_to_linkedin(self):
        with self.assertRaisesRegex(ValueError, "href_does_not_resolve_to_linkedin"):
            validate_rendered_cta(rendered_ref="turn2view0", link_ref="turn2view0", link_id=7,
                                  source_url="https://acme.example/about", page_title="Acme Systems",
                                  raw_source_block="Source: https://acme.example/about turn2view0\n[7] href=https://attacker.example/linkedin.com/company/123456/employees/")
        with self.assertRaisesRegex(ValueError, "link_id_and_href_not_present"):
            validate_rendered_cta(rendered_ref="turn2view0", link_ref="turn2view0", link_id=7,
                                  source_url="https://acme.example/about", page_title="Acme Systems",
                                  raw_source_block="Source: https://acme.example/about turn2view0\n【7†see all employees】")

    def test_linkedin_employee_cta_requires_one_exact_facet_and_real_linkedin_host(self):
        single = "https://fr.linkedin.com/signup/cold-join?session_redirect=https%3A%2F%2Fwww.linkedin.com%2Fsearch%2Fresults%2Fpeople%2F%3FfacetCurrentCompany%3D%255B123456%255D"
        multi = "https://www.linkedin.com/signup/cold-join?session_redirect=https%3A%2F%2Fwww.linkedin.com%2Fsearch%2Fresults%2Fpeople%2F%3FfacetCurrentCompany%3D%255B123456%252C%2B789012%255D"
        spoof = single.replace("fr.linkedin.com", "fr.linkedin.com.attacker.example")
        self.assertEqual(parse_linkedin_employee_cta_id(single), "123456")
        self.assertIsNone(parse_linkedin_employee_cta_id(multi))
        self.assertIsNone(parse_linkedin_employee_cta_id(spoof))
        self.assertIsNone(parse_linkedin_company_id("linkedin.com/company/123456/employees"))

    def test_rendered_link_id_cannot_borrow_next_anchor_href(self):
        raw = (
            "Source: https://acme.example/about turn2view0\n"
            "【7†View employees】 【8†Company page】 href=https://www.linkedin.com/company/123456/employees/"
        )
        links = extract_raw_rendered_links(raw, "turn2view0")
        self.assertEqual([link["id"] for link in links], [8])
        with self.assertRaisesRegex(ValueError, "link_id_and_href_not_present"):
            validate_rendered_cta(rendered_ref="turn2view0", link_ref="turn2view0", link_id=7,
                                  source_url="https://acme.example/about", page_title="Acme Systems",
                                  raw_source_block=raw)

    def test_relative_linkedin_text_from_foreign_source_is_not_a_linkedin_host(self):
        raw = "Source: https://acme.example/about turn2view0\n【7†View employees】 href=linkedin.com/company/123456/employees/"
        with self.assertRaisesRegex(ValueError, "link_id_and_href_not_present"):
            validate_rendered_cta(rendered_ref="turn2view0", link_ref="turn2view0", link_id=7,
                                  source_url="https://acme.example/about", page_title="Acme Systems",
                                  raw_source_block=raw)

    def test_unsupported_raw_packet_fields_are_adapter_gap_exceptions(self):
        evidence = good_evidence(
            raw={"provider_body": "saved elsewhere"},
            corporate_raw={"requested_url": "https://acme.example/about"},
            http_status=200,
        )
        normalized = normalize_packet_evidence(evidence, full_row(), field="website_url",
                                               proposed_value="https://acme.example")
        status, reason, _ = validate_candidate("website_url", "https://acme.example", normalized, full_row())
        self.assertEqual((status, reason), ("exception", "adapter_gap:unsupported_raw_evidence_shape"))
        self.assertNotIn("http_status", normalized)
        self.assertNotIn("identity", normalized)
        self.assertEqual(normalized["source_access"]["status"], "unknown")

    def test_careers_source_file_without_line_is_adapter_gap_not_identity(self):
        evidence = good_evidence(source_file="footer.jsonl", http_status=200)
        normalized = normalize_packet_evidence(evidence, full_row(), field="careers_url",
                                               proposed_value="https://acme.example/careers")
        status, reason, _ = validate_candidate(
            "careers_url", "https://acme.example/careers", normalized, full_row()
        )
        self.assertEqual((status, reason), ("exception", "adapter_gap:source_file_line_shape_unsupported"))
        self.assertNotIn("http_status", normalized)
        self.assertNotIn("identity", normalized)

    def test_unknown_source_status_is_not_fabricated(self):
        evidence = good_evidence()
        status, reason, _ = validate_candidate("website_url", "https://acme.example", evidence, full_row())
        self.assertEqual((status, reason), ("valid_pending_review", None))
        evidence.pop("source_access")
        self.assertEqual(validate_candidate("website_url", "https://acme.example", evidence, full_row())[1], "source_access_unknown_without_content_observation")

    def test_public_fetch_guard_blocks_linkedin_and_private_dns(self):
        with self.assertRaises(PermissionError):
            safe_public_target("https://www.linkedin.com/company/acme/")
        with self.assertRaises(PermissionError):
            safe_public_target("https://127.0.0.1/admin")
        with self.assertRaises(ValueError):
            safe_public_target("https://example.com:8443/jobs")

    def test_current_company_employee_facet_must_be_single_exact_org(self):
        self.assertEqual(parse_linkedin_company_id("https://www.linkedin.com/search/results/people/?currentCompany=%5B%22123456%22%5D"), "123456")
        nested = "https://www.linkedin.com/signup/cold-join?session_redirect=https%3A%2F%2Fwww.linkedin.com%2Fsearch%2Fresults%2Fpeople%2F%3FfacetCurrentCompany%3D%255B60870%255D&trk=org-employees_cta_face-pile-cta"
        self.assertEqual(parse_linkedin_company_id(nested), "60870")
        self.assertIsNone(parse_linkedin_company_id(nested.replace("facetCurrentCompany%3D%255B60870%255D", "facetCurrentCompany%3D%255B60870%255D%26keywords%3Dfoo")))
        self.assertIsNone(parse_linkedin_company_id("https://www.linkedin.com/search/results/people/?currentCompany=%5B%22123%22%2C%22456%22%5D"))
        self.assertIsNone(parse_linkedin_company_id("https://www.linkedin.com/search/results/people/?currentCompany=%5B%22123%22%5D&keywords=acme"))


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.baseline_file = self.root / "baseline.json"
        self.baseline_file.write_text(json.dumps([full_row()]), encoding="utf-8")
        self.state = self.root / "state.sqlite"
        init_state(self.state, self.baseline_file)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def _employee_target(company_id="123456"):
        return (
            "https://www.linkedin.com/signup/cold-join?session_redirect="
            "https%3A%2F%2Fwww.linkedin.com%2Fsearch%2Fresults%2Fpeople%2F"
            f"%3FfacetCurrentCompany%3D%255B{company_id}%255D&trk=employees-cta"
        )

    def _legacy_capture_docs(self, *, target_id="123456", primary_ref="turn1view0",
                             find_ref="turn2view0", link_id=11, marker="View all 42 employees",
                             click_ref=None, click_id=None, click_web=None,
                             queue_overrides=None, find_block=None):
        page_url = "https://www.linkedin.com/company/acme/"
        if find_block is None:
            invocation = json.dumps({"ref_id": primary_ref, "pattern": "View all"}, separators=(",", ":"))
            find_block = (
                f"Acme Systems | LinkedIn ({page_url})\n"
                "L0: 【0†LinkedIn】\n"
                "L12: # Acme Systems\n"
                f"L22: * 【{link_id}†{marker}】\n"
                f"cite{find_ref} [wordlim 200]; Content type: text/html; Source: find({invocation}); Total lines: 369"
            )
        find_doc = {
            "rows": [{
                "company_key": "acme",
                "company_name": "Acme Systems",
                "source_ref": primary_ref,
                "requested_url": page_url,
                "title": f"Acme Systems | LinkedIn ({page_url})",
            }],
            "findings": find_block,
        }
        target = self._employee_target(target_id)
        call_ref = find_ref if click_ref is None else click_ref
        call_link_id = link_id if click_id is None else click_id
        if click_web is None:
            invocation = json.dumps({"ref_id": call_ref, "id": call_link_id}, separators=(",", ":"))
            click_web = (
                f"www.linkedin.com ({target})\n"
                f"citeturn3view0 [wordlim 100]; Content type: text/html; "
                f"Source: click({invocation}); Redirected to URL: https://www.linkedin.com/signup; Total lines: 55"
            )
        queue_row = {
            "company_key": "acme",
            "existing_page_ref": primary_ref,
            "find_result_ref": find_ref,
            "employee_link_id": link_id,
            "target_url": None,
            "facetCurrentCompany_ids": [],
        }
        if queue_overrides:
            queue_row.update(queue_overrides)
        click_doc = {"queue": [queue_row], "web": click_web}
        return find_doc, click_doc, target, page_url

    def _import_legacy_packet(self, find_doc, click_doc, *, proposed_id="123456",
                              evidence_overrides=None):
        evidence_root = self.root / "evidence"
        evidence_root.mkdir(mode=0o700, exist_ok=True)
        os.chmod(evidence_root, 0o700)
        (evidence_root / "find.json").write_text(json.dumps(find_doc), encoding="utf-8")
        (evidence_root / "click.json").write_text(json.dumps(click_doc), encoding="utf-8")
        evidence = {
            "raw_find_file": "find.json",
            "raw_click_file": "click.json",
            "primary_page_ref": "turn1view0",
            "find_result_ref": "turn2view0",
            "employee_link_id": 11,
            "url": self._employee_target("999999"),
            "facetCurrentCompany_ids": ["999999"],
            "profile_name": "Caller Supplied Wrong Name",
            "profile_website": "https://wrong.example",
            "official_website_url": "https://wrong.example",
            "http_status": 200,
            "source_access": {"status": "content_observed", "method": "official_site"},
            "identity": {
                "observed_company_name": "Caller Supplied Wrong Name",
                "business_context": "Caller supplied context.",
                "name_match": True,
                "official_domain_match": True,
            },
        }
        if evidence_overrides:
            evidence.update(evidence_overrides)
        conn = open_state(self.state)
        try:
            packet = {
                "candidates": [{
                    "company_key": "acme",
                    "fields": {"linkedin_org_id": proposed_id},
                    "expected": {"linkedin_org_id": None},
                    "evidence": {"linkedin_org_id": evidence},
                }]
            }
            counts = import_packet(conn, packet, evidence_root=evidence_root)
            saved = conn.execute(
                "SELECT validation_status,validation_reason,evidence_json FROM proposals ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
            return (counts, saved["validation_status"], saved["validation_reason"], json.loads(saved["evidence_json"]))
        finally:
            conn.close()

    def test_resumed_queue_reconciles_exact_keys_after_partial_checkpoint(self):
        conn = open_state(self.state)
        tasks = [{"company_key": "acme", "task_kind": "corporate_profile", "provider": "corporate", "source_url": f"https://acme.example/page/{i}"} for i in range(46)]
        self.assertEqual(enqueue_tasks(conn, tasks), {"added": 46, "deduplicated": 0})
        self.assertEqual(enqueue_tasks(conn, tasks), {"added": 0, "deduplicated": 46})
        first = claim_jobs(conn, 46, 300, now=1000)
        self.assertEqual(len(first), 46)
        outcomes = []
        for item in first[:40]:
            result = {"reason": "http_ok"}
            record_job(conn, item["job_id"], item["lease_token"], "completed", result, now=1001)
            outcomes.append({"task": next(task for task in tasks if task_id_for_test(task) == item["job_id"])})
        checkpoint = reconcile_expected(conn, tasks, outcomes)
        self.assertEqual(len(checkpoint["missing_outcomes"]), 6)
        self.assertFalse(checkpoint["complete"])
        conn.close()
        conn = open_state(self.state)  # restart from durable queue state, not array offset
        resumed = claim_jobs(conn, 46, 300, now=1301)
        self.assertEqual(len(resumed), 6)
        for item in resumed:
            result = {"reason": "http_ok"}
            record_job(conn, item["job_id"], item["lease_token"], "completed", result, now=1302)
            outcomes.append({"task": next(task for task in tasks if task_id_for_test(task) == item["job_id"])})
        final = reconcile_expected(conn, tasks, outcomes)
        self.assertTrue(final["complete"])
        self.assertEqual(final["expected_count"], 46)
        self.assertFalse(final["duplicate_outcomes"])
        conn.close()

    def test_linkedin_import_jobs_are_never_claimed(self):
        conn = open_state(self.state)
        task = {"company_key": "acme", "task_kind": "linkedin_identity_import", "provider": "linkedin_import", "source_url": "https://www.linkedin.com/company/acme/"}
        enqueue_tasks(conn, [task])
        self.assertEqual(conn.execute("SELECT status FROM jobs").fetchone()[0], "awaiting_import")
        self.assertEqual(claim_jobs(conn, 10, 60), [])
        conn.close()

    def test_429_retry_after_and_jitter_are_cooldown_not_immediate_retry(self):
        status, result = source_outcome("corporate", 429, {"Retry-After": "120"}, attempt=3, rand=lambda: 0)
        self.assertEqual(status, "cooldown_pending")
        self.assertEqual(result["retry_after_seconds"], 120)
        self.assertGreater(backoff_delay(4, 60, rand=lambda: 0.5), 60)
        conn = open_state(self.state)
        task = {"company_key": "acme", "task_kind": "corporate_profile", "provider": "corporate", "source_url": "https://acme.example"}
        enqueue_tasks(conn, [task])
        item = claim_jobs(conn, 1, 60, now=1000)[0]
        record_job(conn, item["job_id"], item["lease_token"], status, result, now=1000)
        self.assertEqual(claim_jobs(conn, 1, 60, now=1100), [])
        self.assertEqual(len(claim_jobs(conn, 1, 60, now=1121)), 1)
        conn.close()

    def test_per_company_per_field_report_has_all_seven_fields(self):
        conn = open_state(self.state)
        report = make_report(conn)
        self.assertEqual(report["company_count"], 1)
        self.assertEqual(set(report["rows"][0]["fields"]), set(FULL_FIELDS_FOR_TEST))
        conn.close()

    def test_corporate_fetch_is_disabled_before_lease_or_network(self):
        conn = open_state(self.state)
        tasks = [
            {"company_key": "acme", "task_kind": "corporate_profile", "provider": "corporate", "source_url": "https://acme.example/about"},
        ]
        enqueue_tasks(conn, tasks)
        conn.close()
        with patch("cli.fetch_public_https") as fetch:
            with self.assertRaisesRegex(PermissionError, "disabled until jittered normal host pacing"):
                run_corporate_jobs(self.state, limit=1, concurrency=1, min_host_interval=30)
        fetch.assert_not_called()
        conn = open_state(self.state)
        self.assertEqual(conn.execute("SELECT status FROM jobs").fetchone()[0], "pending")
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM host_budget").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM source_cache").fetchone()[0], 0)
        conn.close()

    def test_stale_expected_packet_is_noop_only_when_new_value_is_already_current(self):
        current_row = full_row()
        current_row["linkedin_org_id"] = "123456"
        baseline = self.root / "baseline-existing.json"
        baseline.write_text(json.dumps([current_row]), encoding="utf-8")
        state = self.root / "state-existing.sqlite"
        init_state(state, baseline)
        conn = open_state(state)
        try:
            replay = {"candidates": [{
                "company_key": "acme",
                "fields": {"linkedin_org_id": "123456"},
                "expected": {"linkedin_org_id": None},
                "evidence": {"linkedin_org_id": {}},
            }]}
            self.assertEqual(import_packet(conn, replay), {"imported": 0, "rejected": 0, "exceptions": 0, "unchanged": 1})
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM proposals").fetchone()[0], 0)
            conflict = {"candidates": [{
                "company_key": "acme",
                "fields": {"linkedin_org_id": "999999"},
                "expected": {"linkedin_org_id": None},
                "evidence": {"linkedin_org_id": {}},
            }]}
            with self.assertRaisesRegex(ValueError, "stale expected old value"):
                import_packet(conn, conflict)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM proposals").fetchone()[0], 0)
        finally:
            conn.close()

    def _prepare_public_index_request(self, *, include_reference=True, raw_response_override=None):
        evidence_root = self.root / "public-index-evidence"
        evidence_root.mkdir(mode=0o700, exist_ok=True)
        os.chmod(evidence_root, 0o700)
        batch_dir = evidence_root / "batches"
        batch_dir.mkdir(mode=0o700, exist_ok=True)
        source_url = "https://www.linkedin.com/company/acme/"
        query = 'site:linkedin.com/company "Acme Systems"'
        request_id = sha256_value({"company_key": "acme", "query": query})
        plan = {
            "baseline_sha256": sha256_value([full_row()]),
            "jobs": [{
                "request_id": request_id, "company_key": "acme", "company_name": "Acme Systems",
                "expected_old": None, "registry_website": "https://old.acme.example",
                "registry_linkedin_url": None, "lead_kind": "publisher_link_lead",
                "publisher_leads": [{"slug": "acme"}], "query": query,
            }],
        }
        (evidence_root / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
        search_ref = "turn100search0"
        requests = [{"request_id": request_id, "company_key": "acme", "query": query, "slug": "acme"}]
        references = [{
            "request_id": request_id, "company_key": "acme", "ref": search_ref,
            "url": source_url, "title": "Acme Systems | LinkedIn",
        }] if include_reference else []
        raw_response = raw_response_override or (
            f"Acme Systems | LinkedIn ({source_url})\n【{search_ref}】 [wordlim 100]; indexed company page"
            if include_reference else "No indexed company reference returned."
        )
        (batch_dir / "batch-001.json").write_text(
            json.dumps({"requests": requests, "indexed_company_references": references, "raw_response": raw_response}),
            encoding="utf-8",
        )
        conn = open_state(self.state)
        root_result = public_index_import_root_batches(conn, "plan.json", batch_dir, evidence_root)
        return conn, evidence_root, request_id, search_ref, source_url, root_result

    def test_public_index_root_import_requires_ref_url_title_in_same_raw_block(self):
        raw = ("-" * 80 + "\n").join([
            "Wrong title | LinkedIn (https://www.linkedin.com/company/wrong/)\n【turn100search0】",
            "Wrong title | LinkedIn (https://www.linkedin.com/company/acme/)\n【turn100search1】",
            "Acme Systems | LinkedIn (https://www.linkedin.com/company/wrong/)\n【turn100search2】",
        ])
        conn, _root, _request_id, _search_ref, _source_url, result = self._prepare_public_index_request(
            raw_response_override=raw,
        )
        try:
            self.assertEqual(result["indexed_refs"], 0)
            self.assertEqual(result["adapter_gaps"], 1)
            self.assertEqual(result["missing_refs"], 0)
            self.assertEqual(conn.execute("SELECT search_status FROM public_index_requests").fetchone()[0], "pending")
        finally:
            conn.close()

    def test_public_index_root_import_binds_metadata_title_within_exact_rendered_block(self):
        source_url = "https://www.linkedin.com/company/acme/"
        raw = (
            f"Acme Systems ({source_url})\n【turn100search0】 [wordlim 80]; "
            "Acme Systems | LinkedIn"
        )
        conn, _root, _request_id, _search_ref, _source_url, result = self._prepare_public_index_request(
            raw_response_override=raw,
        )
        try:
            self.assertEqual(result["indexed_refs"], 1)
            self.assertEqual(result["adapter_gaps"], 0)
            saved = conn.execute(
                "SELECT search_status,search_ref,search_url FROM public_index_requests"
            ).fetchone()
            self.assertEqual(saved["search_status"], "indexed_ref")
            self.assertEqual(saved["search_ref"], "turn100search0")
            self.assertEqual(saved["search_url"], source_url)
        finally:
            conn.close()

    def test_public_index_root_import_rejects_metadata_url_absent_from_source_block(self):
        raw = (
            "Acme Systems (https://www.linkedin.com/company/acme/?trk=search)\n"
            "【turn100search0】 [wordlim 80]; Acme Systems | LinkedIn"
        )
        conn, _root, _request_id, _search_ref, _source_url, result = self._prepare_public_index_request(
            raw_response_override=raw,
        )
        try:
            self.assertEqual(result["indexed_refs"], 0)
            self.assertEqual(result["adapter_gaps"], 1)
        finally:
            conn.close()

    def test_public_index_linkedin_content_stages_require_explicit_gate(self):
        conn, evidence_root, _request_id, _search_ref, _source_url, _ = self._prepare_public_index_request()
        try:
            with self.assertRaisesRegex(PermissionError, "explicit --allow-indexed-linkedin-content"):
                export_public_index_batch(conn, "open", evidence_root / "open.json", limit=4)
            self.assertIsNone(conn.execute(
                "SELECT active_batch_id FROM public_index_requests"
            ).fetchone()[0])
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM public_index_batches WHERE status='awaiting_response'"
            ).fetchone()[0], 0)
        finally:
            conn.close()

    def test_public_index_manifest_pre_call_hash_and_tool_shape_verification(self):
        conn, evidence_root, _request_id, _search_ref, _source_url, _ = self._prepare_public_index_request(include_reference=False)
        try:
            manifest_path = evidence_root / "search-manifest.json"
            export_public_index_batch(
                conn, "search", manifest_path, limit=4, now=time.time() + 10000,
            )
            verified = verify_public_index_manifest_file(conn, manifest_path, evidence_root)
            self.assertTrue(verified["verified"])
            self.assertEqual(verified["stage"], "search")
            manifest = json.loads(manifest_path.read_text())

            bad_hash = dict(manifest)
            bad_hash["manifest_sha256"] = "0" * 64
            bad_hash_path = evidence_root / "bad-hash-manifest.json"
            bad_hash_path.write_text(json.dumps(bad_hash), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "canonical JSON"):
                verify_public_index_manifest_file(conn, bad_hash_path, evidence_root)

            bad_shape = json.loads(json.dumps(manifest))
            bad_shape["tool_args"]["system2_search_query"][0]["domains"] = ["example.com"]
            bad_shape["manifest_sha256"] = sha256_value(
                {key: value for key, value in bad_shape.items() if key != "manifest_sha256"}
            )
            bad_shape_path = evidence_root / "bad-shape-manifest.json"
            bad_shape_path.write_text(json.dumps(bad_shape), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "search arguments do not bind"):
                verify_public_index_manifest_file(conn, bad_shape_path, evidence_root)

            recomputed = json.loads(json.dumps(manifest))
            replacement_query = recomputed["requests"][0]["query"] + " revised"
            recomputed["requests"][0]["query"] = replacement_query
            recomputed["requests"][0]["query_sha256"] = hashlib.sha256(replacement_query.encode("utf-8")).hexdigest()
            recomputed["tool_args"]["system2_search_query"][0]["q"] = replacement_query
            recomputed["manifest_sha256"] = sha256_value(
                {key: value for key, value in recomputed.items() if key != "manifest_sha256"}
            )
            recomputed_path = evidence_root / "recomputed-manifest.json"
            recomputed_path.write_text(json.dumps(recomputed), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "differs from the exact persisted export"):
                verify_public_index_manifest_file(conn, recomputed_path, evidence_root)
        finally:
            conn.close()

    def test_public_index_provider_429_retries_only_after_cooldown(self):
        conn, evidence_root, request_id, _search_ref, _source_url, _ = self._prepare_public_index_request(include_reference=False)
        try:
            manifest_path = evidence_root / "search.json"
            export_public_index_batch(conn, "search", manifest_path, limit=4, now=time.time() + 10000)
            manifest = json.loads(manifest_path.read_text())
            capture = {
                "provider": manifest["provider"], "stage": manifest["stage"],
                "operation": manifest["operation"], "batch_id": manifest["batch_id"],
                "manifest_sha256": manifest["manifest_sha256"], "request_ids": manifest["request_ids"],
                "tool_args": manifest["tool_args"], "raw_result_text": "Rate limited",
                "is_error": True, "provider_error_status": 429,
            }
            capture_path = evidence_root / "search-429.json"
            capture_path.write_text(json.dumps(capture), encoding="utf-8")
            result = public_index_import_capture(conn, capture_path, evidence_root)
            self.assertEqual(result["deferred"], 1)
            saved = conn.execute(
                "SELECT search_status,search_not_before FROM public_index_requests WHERE request_id=?",
                (request_id,),
            ).fetchone()
            self.assertEqual(saved["search_status"], "retry_pending")
            self.assertIsNotNone(saved["search_not_before"])
            self.assertEqual(conn.execute("SELECT status FROM jobs").fetchone()[0], "cooldown_pending")
            with self.assertRaisesRegex(ValueError, "public_index_provider_cooldown_active"):
                export_public_index_batch(
                    conn, "open", evidence_root / "open-retry.json", limit=4,
                    allow_indexed_linkedin_content=True, now=0,
                )
            pause_report = make_report(conn)["public_index"]["provider_pause"]
            self.assertEqual(pause_report["pause_kind"], "search_service_cooldown")
            self.assertGreater(pause_report["paused_until"], time.time())
            with self.assertRaisesRegex(ValueError, "public_index_provider_cooldown_active"):
                export_public_index_batch(conn, "search", evidence_root / "search-retry.json",
                                          limit=4, now=0)
            with self.assertRaisesRegex(ValueError, "public_index_provider_cooldown_active"):
                export_public_index_batch(conn, "open", evidence_root / "open-retry.json", limit=4,
                                          allow_indexed_linkedin_content=True, now=0)
            retried = export_public_index_batch(
                conn, "search", evidence_root / "search-after-cooldown.json", limit=4,
                now=saved["search_not_before"] + 1,
            )
            self.assertEqual(retried["request_count"], 1)
            retry_manifest = json.loads((evidence_root / "search-after-cooldown.json").read_text())
            self.assertEqual(retry_manifest["request_ids"], [request_id])
        finally:
            conn.close()

    def test_public_index_exact_open_429_is_terminal_no_retry(self):
        conn, evidence_root, request_id, search_ref, source_url, _ = self._prepare_public_index_request()
        try:
            manifest_path = evidence_root / "open.json"
            export_public_index_batch(conn, "open", manifest_path, limit=4,
                                      allow_indexed_linkedin_content=True)
            manifest = json.loads(manifest_path.read_text())
            call = json.dumps({"ref_id": search_ref}, separators=(",", ":"))
            raw = (
                f"Acme Systems | LinkedIn ({source_url})\n"
                "citeturn200view0 [wordlim 40]; "
                f"Source: open({call}); Failed to fetch <{source_url}>: (429) Too Many Requests"
            )
            capture = {
                "provider": manifest["provider"], "stage": "open", "operation": manifest["operation"],
                "batch_id": manifest["batch_id"], "manifest_sha256": manifest["manifest_sha256"],
                "request_ids": manifest["request_ids"], "tool_args": manifest["tool_args"],
                "raw_result_text": raw, "is_error": False,
            }
            capture_path = evidence_root / "open-429.json"
            capture_path.write_text(json.dumps(capture), encoding="utf-8")
            result = public_index_import_capture(conn, capture_path, evidence_root)
            self.assertEqual(result["request_outcomes"], {"cooldown_pending": 1})
            saved = conn.execute(
                "SELECT open_status,open_not_before FROM public_index_requests WHERE request_id=?",
                (request_id,),
            ).fetchone()
            self.assertEqual(saved["open_status"], "cooldown_pending")
            self.assertIsNotNone(saved["open_not_before"])
            with self.assertRaisesRegex(ValueError, "no public-index open requests are eligible"):
                export_public_index_batch(conn, "open", evidence_root / "open-retry.json", limit=4,
                                          now=time.time() + 100000,
                                          allow_indexed_linkedin_content=True)
        finally:
            conn.close()

    def test_public_index_exact_open_403_is_terminal_policy_denial(self):
        conn, evidence_root, request_id, search_ref, source_url, _ = self._prepare_public_index_request()
        try:
            manifest_path = evidence_root / "open.json"
            export_public_index_batch(conn, "open", manifest_path, limit=4,
                                      allow_indexed_linkedin_content=True)
            manifest = json.loads(manifest_path.read_text())
            call = json.dumps({"ref_id": search_ref}, separators=(",", ":"))
            raw = (
                f"Acme Systems | LinkedIn ({source_url})\n"
                "citeturn200view0 [wordlim 40]; "
                f"Source: open({call}); Failed to fetch <{source_url}>: (403) Forbidden"
            )
            capture = {
                "provider": manifest["provider"], "stage": "open", "operation": manifest["operation"],
                "batch_id": manifest["batch_id"], "manifest_sha256": manifest["manifest_sha256"],
                "request_ids": manifest["request_ids"], "tool_args": manifest["tool_args"],
                "raw_result_text": raw, "is_error": False,
            }
            capture_path = evidence_root / "open-403.json"
            capture_path.write_text(json.dumps(capture), encoding="utf-8")
            result = public_index_import_capture(conn, capture_path, evidence_root)
            self.assertEqual(result["request_outcomes"], {"policy_denied": 1})
            saved = conn.execute(
                "SELECT open_status FROM public_index_requests WHERE request_id=?", (request_id,)
            ).fetchone()
            self.assertEqual(saved["open_status"], "policy_denied")
            self.assertEqual(conn.execute("SELECT status FROM jobs").fetchone()[0], "policy_denied")
            with self.assertRaisesRegex(ValueError, "no public-index open requests are eligible"):
                export_public_index_batch(conn, "open", evidence_root / "open-retry.json", limit=4,
                                          now=time.time() + 100000,
                                          allow_indexed_linkedin_content=True)
        finally:
            conn.close()

    def test_public_index_search_collapses_same_slug_hosts_to_canonical_www_root(self):
        conn, evidence_root, request_id, _search_ref, _source_url, _ = self._prepare_public_index_request(include_reference=False)
        try:
            manifest_path = evidence_root / "search.json"
            export_public_index_batch(conn, "search", manifest_path, limit=4, now=time.time() + 10000)
            manifest = json.loads(manifest_path.read_text())
            root = "Acme Systems | LinkedIn (https://www.linkedin.com/company/acme/)\n【turn100search0】 [wordlim 100]"
            jobs = "Acme Systems | LinkedIn (https://www.linkedin.com/company/acme/jobs/)\n【turn100search1】 [wordlim 100]"
            localized = "Acme Systems | LinkedIn (https://mt.linkedin.com/company/acme/)\n【turn100search2】 [wordlim 100]"
            localized_jobs = "Acme Systems | LinkedIn (https://ru.linkedin.com/company/acme/jobs/)\n【turn100search3】 [wordlim 100]"
            localized_ua = "Acme Systems | LinkedIn (https://ua.linkedin.com/company/acme/)\n【turn100search4】 [wordlim 100]"
            raw_text = ("-" * 80 + "\n").join([localized, jobs, localized_jobs, localized_ua, root])
            capture = {
                "provider": manifest["provider"], "stage": "search", "operation": manifest["operation"],
                "batch_id": manifest["batch_id"], "manifest_sha256": manifest["manifest_sha256"],
                "request_ids": manifest["request_ids"], "tool_args": manifest["tool_args"],
                "raw_result_text": raw_text, "is_error": False,
            }
            capture_path = evidence_root / "search-capture.json"
            capture_path.write_text(json.dumps(capture), encoding="utf-8")
            self.assertEqual(public_index_import_capture(conn, capture_path, evidence_root)["request_outcomes"], {"indexed_ref": 1})
            saved = conn.execute(
                "SELECT search_status,search_ref,search_url FROM public_index_requests WHERE request_id=?",
                (request_id,),
            ).fetchone()
            self.assertEqual(saved["search_status"], "indexed_ref")
            self.assertEqual(saved["search_ref"], "turn100search0")
            self.assertEqual(saved["search_url"], "https://www.linkedin.com/company/acme/")
        finally:
            conn.close()

    def test_public_index_invalid_open_reference_requeues_search_not_url_fallback(self):
        conn, evidence_root, request_id, _search_ref, _source_url, _ = self._prepare_public_index_request()
        try:
            manifest_path = evidence_root / "open.json"
            export_public_index_batch(conn, "open", manifest_path, limit=4, allow_indexed_linkedin_content=True)
            manifest = json.loads(manifest_path.read_text())
            capture = {
                "provider": manifest["provider"], "stage": "open", "operation": manifest["operation"],
                "batch_id": manifest["batch_id"], "manifest_sha256": manifest["manifest_sha256"],
                "request_ids": manifest["request_ids"], "tool_args": manifest["tool_args"],
                "raw_result_text": "Unable to resolve open call due to invalid ref_id argument",
                "is_error": False,
            }
            capture_path = evidence_root / "open-capture.json"
            capture_path.write_text(json.dumps(capture), encoding="utf-8")
            result = public_index_import_capture(conn, capture_path, evidence_root)
            self.assertEqual(result["request_outcomes"], {"unverified": 1})
            saved = conn.execute(
                "SELECT search_status,search_ref,open_status,search_not_before FROM public_index_requests WHERE request_id=?",
                (request_id,),
            ).fetchone()
            self.assertEqual(saved["search_status"], "unverified")
            self.assertEqual(saved["open_status"], "invalid_ref")
            self.assertIsNotNone(saved["search_not_before"])
            self.assertEqual(conn.execute("SELECT status FROM jobs").fetchone()[0], "cooldown_pending")
            new_manifest_path = evidence_root / "search-retry.json"
            export_public_index_batch(conn, "search", new_manifest_path, limit=4, now=time.time() + 10000)
            retry_manifest = json.loads(new_manifest_path.read_text())
            self.assertEqual(retry_manifest["stage"], "search")
            self.assertEqual(retry_manifest["request_ids"], [request_id])
            self.assertEqual(retry_manifest["tool_args"].keys(), {"system2_search_query", "response_length"})
        finally:
            conn.close()

    def test_public_index_provider_ref_mismatch_requeues_bounded_search_only(self):
        conn, evidence_root, request_id, search_ref, source_url, _ = self._prepare_public_index_request()
        try:
            open_manifest_path = evidence_root / "open-mismatch.json"
            export_public_index_batch(
                conn, "open", open_manifest_path, limit=4, allow_indexed_linkedin_content=True,
            )
            open_manifest = json.loads(open_manifest_path.read_text())
            returned_ref = "turn999search7"
            source_call = json.dumps({"ref_id": returned_ref}, separators=(",", ":"))
            raw = (
                f"Acme Systems | LinkedIn ({source_url})\nL12: # Acme Systems\n"
                f"citeturn888view0 [wordlim 80]; Source: open({source_call}); Total lines: 40"
            )
            open_capture = {
                "provider": open_manifest["provider"], "stage": "open", "operation": "open",
                "batch_id": open_manifest["batch_id"], "manifest_sha256": open_manifest["manifest_sha256"],
                "request_ids": open_manifest["request_ids"], "tool_args": open_manifest["tool_args"],
                "raw_result_text": raw, "is_error": False,
            }
            capture_path = evidence_root / "open-mismatch-capture.json"
            capture_path.write_text(json.dumps(open_capture), encoding="utf-8")
            result = public_index_import_capture(conn, capture_path, evidence_root)
            self.assertEqual(result["request_outcomes"], {"provider_ref_mismatch": 1})
            saved = conn.execute(
                "SELECT search_status,search_ref,search_not_before,open_status FROM public_index_requests WHERE request_id=?",
                (request_id,),
            ).fetchone()
            self.assertEqual(saved["search_status"], "unverified")
            self.assertEqual(saved["search_ref"], search_ref)
            self.assertIsNotNone(saved["search_not_before"])
            self.assertEqual(saved["open_status"], "provider_ref_mismatch")
            with self.assertRaisesRegex(ValueError, "no public-index open requests are eligible"):
                export_public_index_batch(
                    conn, "open", evidence_root / "open-again.json", limit=4,
                    now=time.time() + 100000, allow_indexed_linkedin_content=True,
                )

            search_manifest_path = evidence_root / "search-retry.json"
            export_public_index_batch(
                conn, "search", search_manifest_path, limit=4, now=time.time() + 100000,
            )
            search_manifest = json.loads(search_manifest_path.read_text())
            self.assertEqual(search_manifest["request_ids"], [request_id])
            self.assertEqual(search_manifest["requests"][0]["query"], 'site:linkedin.com/company "Acme Systems"')
            search_capture = {
                "provider": search_manifest["provider"], "stage": "search", "operation": search_manifest["operation"],
                "batch_id": search_manifest["batch_id"], "manifest_sha256": search_manifest["manifest_sha256"],
                "request_ids": search_manifest["request_ids"], "tool_args": search_manifest["tool_args"],
                "raw_result_text": f"Acme Systems | LinkedIn ({source_url})\n【turn100search9】 [wordlim 80]",
                "is_error": False,
            }
            search_capture_path = evidence_root / "search-retry-capture.json"
            search_capture_path.write_text(json.dumps(search_capture), encoding="utf-8")
            self.assertEqual(
                public_index_import_capture(conn, search_capture_path, evidence_root)["request_outcomes"],
                {"indexed_ref": 1},
            )
            refreshed_open_path = evidence_root / "open-refreshed.json"
            export_public_index_batch(
                conn, "open", refreshed_open_path, limit=4, allow_indexed_linkedin_content=True,
            )
            refreshed = json.loads(refreshed_open_path.read_text())
            self.assertEqual(refreshed["tool_args"]["open"], [{"ref_id": "turn100search9"}])
        finally:
            conn.close()

    def test_expired_unanswered_click_uses_fresh_search_not_same_click(self):
        conn, evidence_root, request_id, search_ref, source_url, _ = self._prepare_public_index_request()
        try:
            def import_stage(stage, raw_text, filename):
                manifest_path = evidence_root / f"{filename}-manifest.json"
                export_public_index_batch(
                    conn, stage, manifest_path, limit=4,
                    allow_indexed_linkedin_content=stage in {"open", "find", "click"},
                )
                manifest = json.loads(manifest_path.read_text())
                capture = {
                    "provider": manifest["provider"], "stage": stage,
                    "operation": manifest["operation"], "batch_id": manifest["batch_id"],
                    "manifest_sha256": manifest["manifest_sha256"], "request_ids": manifest["request_ids"],
                    "tool_args": manifest["tool_args"], "raw_result_text": raw_text, "is_error": False,
                }
                capture_path = evidence_root / f"{filename}-capture.json"
                capture_path.write_text(json.dumps(capture), encoding="utf-8")
                return manifest, public_index_import_capture(conn, capture_path, evidence_root)

            open_ref = "turn200view0"
            open_call = json.dumps({"ref_id": search_ref}, separators=(",", ":"))
            _, opened = import_stage(
                "open",
                f"Acme Systems | LinkedIn ({source_url})\nL12: # Acme Systems\n"
                f"cite{open_ref} [wordlim 80]; Source: open({open_call}); Total lines: 40",
                "open",
            )
            self.assertEqual(opened["request_outcomes"], {"opened": 1})
            find_ref = "turn300view0"
            find_call = json.dumps({"ref_id": open_ref, "pattern": "View all"}, separators=(",", ":"))
            _, found = import_stage(
                "find",
                f"Acme Systems | LinkedIn ({source_url})\nL12: # Acme Systems\n"
                f"L22: * 【11†View all 42 employees】\ncite{find_ref} [wordlim 80]; "
                f"Source: find({find_call}); Total lines: 40",
                "find",
            )
            self.assertEqual(found["request_outcomes"], {"cta_found": 1})

            expired_at = time.time() + 100000
            click_path = evidence_root / "click-without-capture.json"
            exported = export_public_index_batch(
                conn, "click", click_path, limit=4, now=expired_at, lease_seconds=5,
                allow_indexed_linkedin_content=True,
            )
            old_click = json.loads(click_path.read_text())
            self.assertEqual(exported["request_count"], 1)
            self.assertEqual(old_click["tool_args"]["click"], [{"ref_id": find_ref, "id": 11}])

            with self.assertRaisesRegex(ValueError, "no public-index click requests are eligible"):
                export_public_index_batch(
                    conn, "click", evidence_root / "click-resume.json", limit=4,
                    now=expired_at + 6, allow_indexed_linkedin_content=True,
                )
            saved = conn.execute(
                "SELECT search_status,search_not_before,click_status FROM public_index_requests WHERE request_id=?",
                (request_id,),
            ).fetchone()
            self.assertEqual(saved["search_status"], "unverified")
            self.assertEqual(saved["click_status"], "call_uncertain")
            self.assertGreater(saved["search_not_before"], expired_at + 6)
            self.assertEqual(conn.execute(
                "SELECT status FROM public_index_batches WHERE batch_id=?", (old_click["batch_id"],)
            ).fetchone()[0], "expired_uncertain")

            refreshed_path = evidence_root / "fresh-search.json"
            export_public_index_batch(conn, "search", refreshed_path, limit=4, now=expired_at + 1000)
            refreshed = json.loads(refreshed_path.read_text())
            self.assertEqual(refreshed["request_ids"], [request_id])
            self.assertEqual(refreshed["requests"][0]["query"], 'site:linkedin.com/company "Acme Systems"')
        finally:
            conn.close()

    def test_public_index_capture_403_is_policy_denied(self):
        conn, evidence_root, _request_id, _search_ref, _source_url, _ = self._prepare_public_index_request()
        try:
            manifest_path = evidence_root / "open.json"
            export_public_index_batch(conn, "open", manifest_path, limit=4, allow_indexed_linkedin_content=True)
            manifest = json.loads(manifest_path.read_text())
            capture = {
                "provider": manifest["provider"], "stage": "open", "operation": manifest["operation"],
                "batch_id": manifest["batch_id"], "manifest_sha256": manifest["manifest_sha256"],
                "request_ids": manifest["request_ids"], "tool_args": manifest["tool_args"],
                "raw_result_text": "Access denied", "is_error": True, "provider_error_status": 403,
            }
            capture_path = evidence_root / "open-denied.json"
            capture_path.write_text(json.dumps(capture), encoding="utf-8")
            result = public_index_import_capture(conn, capture_path, evidence_root)
            self.assertEqual(result["policy_denied"], 1)
            self.assertEqual(conn.execute("SELECT status FROM jobs").fetchone()[0], "policy_denied")
        finally:
            conn.close()

    def test_public_index_saved_batches_flow_through_exact_open_find_click_bridge(self):
        evidence_root = self.root / "public-index-evidence"
        evidence_root.mkdir(mode=0o700)
        os.chmod(evidence_root, 0o700)
        batch_dir = evidence_root / "batches"
        batch_dir.mkdir(mode=0o700)
        source_url = "https://www.linkedin.com/company/acme/"
        query = 'site:linkedin.com/company "Acme Systems"'
        request_id = sha256_value({"company_key": "acme", "query": query})
        plan = {
            "baseline_sha256": sha256_value([full_row()]),
            "jobs": [{
                "request_id": request_id,
                "company_key": "acme",
                "company_name": "Acme Systems",
                "expected_old": None,
                "registry_website": "https://old.acme.example",
                "registry_linkedin_url": None,
                "lead_kind": "publisher_link_lead",
                "publisher_leads": [{"slug": "acme"}],
                "query": query,
            }],
        }
        (evidence_root / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
        search_ref = "turn100search0"
        search_result = f"Acme Systems | LinkedIn ({source_url})\n【{search_ref}】 [wordlim 100]; indexed company page"
        root_batch = {
            "requests": [{"request_id": request_id, "company_key": "acme", "query": query, "slug": "acme"}],
            "indexed_company_references": [{
                "request_id": request_id, "company_key": "acme", "ref": search_ref,
                "url": source_url, "title": "Acme Systems | LinkedIn",
            }],
            "raw_response": search_result,
        }
        (batch_dir / "batch-001.json").write_text(json.dumps(root_batch), encoding="utf-8")
        conn = open_state(self.state)
        try:
            imported_root = public_index_import_root_batches(
                conn, "plan.json", batch_dir, evidence_root
            )
            self.assertEqual(imported_root["indexed_refs"], 1)
            public_dir = evidence_root / "public-index-run"
            public_dir.mkdir(mode=0o700)

            def tool_capture(manifest, raw_result_text, suffix):
                capture = {
                    "provider": manifest["provider"],
                    "stage": manifest["stage"],
                    "operation": manifest["operation"],
                    "batch_id": manifest["batch_id"],
                    "manifest_sha256": manifest["manifest_sha256"],
                    "request_ids": manifest["request_ids"],
                    "tool_args": manifest["tool_args"],
                    "raw_result_text": raw_result_text,
                    "is_error": False,
                }
                path = public_dir / f"{suffix}.json"
                path.write_text(json.dumps(capture), encoding="utf-8")
                return path

            open_manifest_path = public_dir / "open.json"
            exported = export_public_index_batch(conn, "open", open_manifest_path, limit=4, allow_indexed_linkedin_content=True)
            open_manifest = json.loads(open_manifest_path.read_text())
            self.assertEqual(exported["request_count"], 1)
            self.assertEqual(open_manifest["tool_args"]["open"], [{"ref_id": search_ref}])
            open_ref = "turn200view0"
            open_call = json.dumps({"ref_id": search_ref}, separators=(",", ":"))
            open_text = (
                f"Acme Systems | LinkedIn ({source_url})\n"
                "L12: # Acme Systems\n"
                f"cite{open_ref} [wordlim 100]; Source: open({open_call}); Total lines: 40"
            )
            open_capture = tool_capture(open_manifest, open_text, "open-capture")
            self.assertEqual(
                public_index_import_capture(conn, open_capture, evidence_root)["request_outcomes"],
                {"opened": 1},
            )

            find_manifest_path = public_dir / "find.json"
            export_public_index_batch(conn, "find", find_manifest_path, limit=4, allow_indexed_linkedin_content=True)
            find_manifest = json.loads(find_manifest_path.read_text())
            find_ref = "turn300view0"
            find_call = json.dumps({"ref_id": open_ref, "pattern": "View all"}, separators=(",", ":"))
            find_text = (
                f"Acme Systems | LinkedIn ({source_url})\n"
                "L12: # Acme Systems\n"
                "L22: * 【11†View all 42 employees】\n"
                "L23: * 【17†See all employees】\n"
                f"cite{find_ref} [wordlim 100]; Source: find({find_call}); Total lines: 40"
            )
            find_capture = tool_capture(find_manifest, find_text, "find-capture")
            self.assertEqual(
                public_index_import_capture(conn, find_capture, evidence_root)["request_outcomes"],
                {"cta_found": 1},
            )
            saved_request = conn.execute(
                "SELECT employee_link_id,find_result_ref FROM public_index_requests WHERE request_id=?",
                (request_id,),
            ).fetchone()
            self.assertEqual(saved_request["employee_link_id"], 11)
            self.assertEqual(saved_request["find_result_ref"], find_ref)

            click_manifest_path = public_dir / "click.json"
            export_public_index_batch(conn, "click", click_manifest_path, limit=4, allow_indexed_linkedin_content=True)
            click_manifest = json.loads(click_manifest_path.read_text())
            click_ref = "turn400view0"
            target = (
                "https://www.linkedin.com/signup/cold-join?session_redirect="
                "https%3A%2F%2Fwww.linkedin.com%2Fsearch%2Fresults%2Fpeople%2F"
                "%3FfacetCurrentCompany%3D%255B123456%255D&trk=employees-cta"
            )
            click_call = json.dumps({"ref_id": find_ref, "id": 11}, separators=(",", ":"))
            click_text = (
                f"www.linkedin.com ({target})\n"
                f"cite{click_ref} [wordlim 80]; Source: click({click_call}); "
                "Redirected to URL: https://www.linkedin.com/signup; Total lines: 20"
            )
            click_capture = tool_capture(click_manifest, click_text, "click-capture")
            result = public_index_import_capture(conn, click_capture, evidence_root)
            self.assertEqual(result["import_counts"]["imported"], 1)
            proposal = conn.execute(
                "SELECT validation_status,approved,evidence_json FROM proposals WHERE company_key='acme' AND field='linkedin_org_id'"
            ).fetchone()
            evidence = json.loads(proposal["evidence_json"])
            self.assertEqual(proposal["validation_status"], "valid_pending_review")
            self.assertEqual(proposal["approved"], 0)
            self.assertEqual(evidence["public_index_binding"]["linkedin_org_id"], "123456")
            self.assertEqual(evidence["public_index_binding"]["employee_link_id"], 11)
            self.assertEqual(evidence["destination_access_status"], "unknown")
            self.assertNotIn("http_status", evidence)
            report = make_report(conn)
            self.assertEqual(report["public_index"]["request_count"], 1)
            self.assertEqual(report["public_index"]["stage_statuses"]["search"], {"indexed_ref": 1})
            self.assertEqual(report["public_index"]["stage_statuses"]["click"], {"candidate_imported": 1})
        finally:
            conn.close()

    def test_public_index_exact_click_href_survives_429_without_content_claim_or_retry(self):
        conn, evidence_root, request_id, search_ref, source_url, _ = self._prepare_public_index_request()
        try:
            public_dir = evidence_root / "429-run"
            public_dir.mkdir(mode=0o700)

            def capture_stage(stage, raw_result_text, suffix):
                manifest_path = public_dir / f"{suffix}-manifest.json"
                export_public_index_batch(
                    conn, stage, manifest_path, limit=4,
                    allow_indexed_linkedin_content=stage in {"open", "find", "click"},
                )
                manifest = json.loads(manifest_path.read_text())
                capture = {
                    "provider": manifest["provider"], "stage": stage,
                    "operation": manifest["operation"], "batch_id": manifest["batch_id"],
                    "manifest_sha256": manifest["manifest_sha256"], "request_ids": manifest["request_ids"],
                    "tool_args": manifest["tool_args"], "raw_result_text": raw_result_text, "is_error": False,
                }
                capture_path = public_dir / f"{suffix}-capture.json"
                capture_path.write_text(json.dumps(capture), encoding="utf-8")
                return public_index_import_capture(conn, capture_path, evidence_root)

            page_ref = "turn200view0"
            open_call = json.dumps({"ref_id": search_ref}, separators=(",", ":"))
            self.assertEqual(capture_stage(
                "open", f"Acme Systems | LinkedIn ({source_url})\nL12: # Acme Systems\n"
                f"cite{page_ref} [wordlim 100]; Source: open({open_call}); Total lines: 40", "open",
            )["request_outcomes"], {"opened": 1})

            find_ref = "turn300view0"
            find_call = json.dumps({"ref_id": page_ref, "pattern": "View all"}, separators=(",", ":"))
            self.assertEqual(capture_stage(
                "find", f"Acme Systems | LinkedIn ({source_url})\nL12: # Acme Systems\n"
                f"L22: * 【11†View all 42 employees】\ncite{find_ref} [wordlim 100]; "
                f"Source: find({find_call}); Total lines: 40", "find",
            )["request_outcomes"], {"cta_found": 1})

            target = (
                "https://www.linkedin.com/signup/cold-join?session_redirect="
                "https%3A%2F%2Fwww.linkedin.com%2Fsearch%2Fresults%2Fpeople%2F"
                "%3FfacetCurrentCompany%3D%255B123456%255D&trk=employees-cta"
            )
            click_ref = "turn400view0"
            click_call = json.dumps({"ref_id": find_ref, "id": 11}, separators=(",", ":"))
            result = capture_stage(
                "click", f"www.linkedin.com ({target})\ncite{click_ref} [wordlim 80]; "
                f"Source: click({click_call}); Failed to fetch <{target}>: (429) Too Many Requests",
                "click-429",
            )
            self.assertEqual(result["import_counts"]["imported"], 1)
            self.assertEqual(result["request_outcomes"], {"candidate_imported": 1})
            self.assertEqual(result["candidate_outcomes"], {"pending_review": 1})
            proposal = conn.execute(
                "SELECT validation_status,approved,evidence_json FROM proposals WHERE company_key='acme' AND field='linkedin_org_id'"
            ).fetchone()
            evidence = json.loads(proposal["evidence_json"])
            self.assertEqual(proposal["validation_status"], "valid_pending_review")
            self.assertEqual(proposal["approved"], 0)
            self.assertEqual(evidence["public_index_binding"]["linkedin_org_id"], "123456")
            self.assertEqual(evidence["destination_access_status"], "cooldown_pending")
            self.assertEqual(evidence["destination_access_detail"], "wrapped_http_429_in_exact_public_index_click")
            self.assertEqual(evidence["source_access"]["status"], "content_observed")
            self.assertNotIn("employee_content_accessed", evidence)
            saved = conn.execute(
                "SELECT click_status FROM public_index_requests WHERE request_id=?", (request_id,)
            ).fetchone()
            self.assertEqual(saved["click_status"], "candidate_imported")
            with self.assertRaisesRegex(ValueError, "no public-index click requests are eligible"):
                export_public_index_batch(conn, "click", public_dir / "click-retry.json", limit=4,
                                          now=time.time() + 100000,
                                          allow_indexed_linkedin_content=True)
        finally:
            conn.close()

    def test_public_index_unbound_click_429_is_call_uncertain_and_recovers_by_search(self):
        conn, evidence_root, request_id, search_ref, source_url, _ = self._prepare_public_index_request()
        try:
            def capture_stage(stage, raw_result_text, name):
                manifest_path = evidence_root / f"{name}-manifest.json"
                export_public_index_batch(
                    conn, stage, manifest_path, limit=4,
                    allow_indexed_linkedin_content=stage in {"open", "find", "click"},
                )
                manifest = json.loads(manifest_path.read_text())
                capture = {
                    "provider": manifest["provider"], "stage": stage, "operation": manifest["operation"],
                    "batch_id": manifest["batch_id"], "manifest_sha256": manifest["manifest_sha256"],
                    "request_ids": manifest["request_ids"], "tool_args": manifest["tool_args"],
                    "raw_result_text": raw_result_text, "is_error": False,
                }
                path = evidence_root / f"{name}-capture.json"
                path.write_text(json.dumps(capture), encoding="utf-8")
                return public_index_import_capture(conn, path, evidence_root)

            page_ref = "turn200view0"
            open_call = json.dumps({"ref_id": search_ref}, separators=(",", ":"))
            self.assertEqual(capture_stage(
                "open", f"Acme Systems | LinkedIn ({source_url})\nL12: # Acme Systems\n"
                f"cite{page_ref} [wordlim 80]; Source: open({open_call}); Total lines: 40", "open",
            )["request_outcomes"], {"opened": 1})

            find_ref = "turn300view0"
            find_call = json.dumps({"ref_id": page_ref, "pattern": "View all"}, separators=(",", ":"))
            self.assertEqual(capture_stage(
                "find", f"Acme Systems | LinkedIn ({source_url})\nL12: # Acme Systems\n"
                f"L22: * 【11†View all 42 employees】\ncite{find_ref} [wordlim 80]; "
                f"Source: find({find_call}); Total lines: 40", "find",
            )["request_outcomes"], {"cta_found": 1})

            target = (
                "https://www.linkedin.com/signup/cold-join?session_redirect="
                "https%3A%2F%2Fwww.linkedin.com%2Fsearch%2Fresults%2Fpeople%2F"
                "%3FfacetCurrentCompany%3D%255B123456%255D&trk=employees-cta"
            )
            wrong_call = json.dumps({"ref_id": "turn_staleview0", "id": 11}, separators=(",", ":"))
            result = capture_stage(
                "click", f"www.linkedin.com ({target})\nSource: click({wrong_call}); (429) Too Many Requests",
                "click-unbound-429",
            )
            self.assertEqual(result["request_outcomes"], {"call_uncertain": 1})
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM proposals").fetchone()[0], 0)
            saved = conn.execute(
                "SELECT search_status,search_not_before,click_status FROM public_index_requests WHERE request_id=?",
                (request_id,),
            ).fetchone()
            self.assertEqual(saved["click_status"], "call_uncertain")
            self.assertEqual(saved["search_status"], "unverified")
            self.assertIsNotNone(saved["search_not_before"])
            with self.assertRaisesRegex(ValueError, "no public-index click requests are eligible"):
                export_public_index_batch(
                    conn, "click", evidence_root / "old-click-retry.json", limit=4,
                    now=time.time() + 100000, allow_indexed_linkedin_content=True,
                )
            fresh_search = evidence_root / "fresh-search-after-429.json"
            export_public_index_batch(conn, "search", fresh_search, limit=4, now=time.time() + 100000)
            manifest = json.loads(fresh_search.read_text())
            self.assertEqual(manifest["request_ids"], [request_id])
            self.assertEqual(manifest["requests"][0]["query"], 'site:linkedin.com/company "Acme Systems"')
        finally:
            conn.close()

    def test_full_row_projection_is_rejected(self):
        projection = {k: v for k, v in full_row().items() if k not in {"notes", "created_at", "updated_at"}}
        with self.assertRaisesRegex(ValueError, "full SELECT \\* shape"):
            validate_full_baseline([projection])

    def test_private_artifact_paths_cannot_target_worktree(self):
        worktree_path = Path(__file__).resolve().parents[2] / "unsafe-private-output.json"
        with self.assertRaises(PermissionError):
            ensure_private_external_path(worktree_path)

    def test_import_preserves_evidence_and_requires_separate_approval(self):
        conn = open_state(self.state)
        packet = {"updates": [{"company_key": "acme", "fields": {"website_url": "https://acme.example"},
                              "expected": {"website_url": "https://old.acme.example"}, "evidence": {"website_url": good_evidence()}}]}
        self.assertEqual(import_packet(conn, packet)["imported"], 1)
        row = conn.execute("SELECT * FROM proposals").fetchone()
        self.assertEqual(row["approved"], 0)
        approve_candidate(conn, row["candidate_id"], "reviewer-1", candidate_hash(row))
        self.assertEqual(conn.execute("SELECT approved FROM proposals").fetchone()[0], 1)
        conn.close()

    def test_imports_existing_patch_shape_and_hashes_only_private_root_evidence(self):
        raw_root = self.root / "raw"
        raw_root.mkdir(mode=0o700)
        os.chmod(raw_root, 0o700)
        raw_file = raw_root / "raw-page.json"
        raw_file.write_text("Source: https://acme.example/about\nAcme Systems builds industrial software.", encoding="utf-8")
        conn = open_state(self.state)
        packet = {"patches": [{"company_key": "acme", "fields": {"website_url": "https://acme.example"},
                              "expected": {"website_url": "https://old.acme.example"},
                              "evidence": {"website_url": {"url": "https://acme.example/about", "excerpt": "Acme Systems builds industrial software.", "raw_file": str(raw_file), "source_ref": "turn1view0"}},
                              "approved": True}]}
        self.assertEqual(import_packet(conn, packet, evidence_root=raw_root)["imported"], 1)
        stored = json.loads(conn.execute("SELECT evidence_json FROM proposals").fetchone()[0])
        self.assertEqual(len(stored["raw_file_sha256"]), 64)
        self.assertEqual(stored["source_access"]["status"], "content_observed")
        self.assertFalse(conn.execute("SELECT approved FROM proposals").fetchone()[0])
        with self.assertRaises(PermissionError):
            import_packet(conn, {"patches": [{"company_key": "acme", "fields": {"website_url": "https://other.example"}, "evidence": {"website_url": {"raw_file": "../secret", "url": "https://acme.example", "excerpt": "Acme Systems"}}}]}, evidence_root=raw_root)
        conn.close()

    def test_legacy_linkedin_candidate_packet_hashes_and_binds_both_saved_captures(self):
        find_doc, click_doc, target, page_url = self._legacy_capture_docs()
        find_doc["findings"] = find_doc["findings"].replace(
            "L22: * 【11†View all 42 employees】",
            "L22: * 【11†View all 42 employees】\nL23: * 【17†See all employees】",
        )
        counts, status, reason, stored = self._import_legacy_packet(find_doc, click_doc)

        self.assertEqual(counts["imported"], 1)
        self.assertEqual(status, "valid_pending_review")
        self.assertIsNone(reason)
        self.assertTrue(stored["legacy_click_binding"]["verified"])
        self.assertEqual(stored["legacy_click_binding"]["linkedin_org_id"], "123456")
        self.assertEqual(stored["legacy_click_binding"]["employee_link_id"], 11)
        self.assertEqual(stored["source_url"], page_url)
        self.assertEqual(stored["identity"]["observed_company_name"], "Acme Systems")
        self.assertNotIn("official_domain_match", stored["identity"])
        self.assertEqual(stored["destination_access_status"], "unknown")
        self.assertEqual(stored["destination_access_detail"], "signup_redirect_href_only")
        self.assertEqual(stored["source_access"]["status"], "content_observed")
        self.assertNotIn("http_status", stored)
        self.assertNotIn("status", stored)
        self.assertEqual(len(stored["raw_find_sha256"]), 64)
        self.assertEqual(len(stored["raw_click_sha256"]), 64)
        self.assertNotEqual(stored["legacy_click_binding"]["raw_href"], target.replace("123456", "999999"))

    def test_legacy_adapter_rejects_findings_without_raw_employee_cta(self):
        find_doc, click_doc, _, _ = self._legacy_capture_docs()
        find_doc["findings"] = find_doc["findings"].replace(
            "【11†View all 42 employees】", "【11†Follow】"
        )
        counts, status, _, stored = self._import_legacy_packet(find_doc, click_doc)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertFalse(stored["legacy_click_binding"]["verified"])
        self.assertEqual(stored["identity"], {})
        self.assertEqual(stored["source_access"]["status"], "unknown")
        self.assertNotIn("http_status", stored)

    def test_legacy_adapter_rejects_click_result_without_exact_invocation(self):
        find_doc, click_doc, target, _ = self._legacy_capture_docs()
        click_doc["web"] = "clicked " + target
        counts, status, _, stored = self._import_legacy_packet(find_doc, click_doc)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertFalse(stored["legacy_click_binding"]["verified"])
        self.assertEqual(stored["identity"]["observed_company_name"], "Acme Systems")
        self.assertEqual(stored["source_access"]["status"], "content_observed")
        self.assertEqual(stored["destination_access_status"], "unknown")

    def test_legacy_adapter_rejects_wrong_click_ref_and_link_id(self):
        find_doc, click_doc, _, _ = self._legacy_capture_docs(click_ref="turn9view0", click_id=12)
        counts, status, _, stored = self._import_legacy_packet(find_doc, click_doc)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertFalse(stored["legacy_click_binding"]["verified"])
        self.assertEqual(stored["legacy_click_binding"]["reason"], "legacy_click_invocation_target_not_unique_or_exact")

    def test_legacy_adapter_rejects_href_found_only_in_another_result_block(self):
        find_doc, click_doc, target, _ = self._legacy_capture_docs()
        invocation = json.dumps({"ref_id": "turn2view0", "id": 11}, separators=(",", ":"))
        other_invocation = json.dumps({"ref_id": "turn9view0", "id": 12}, separators=(",", ":"))
        click_doc["web"] = (
            f"citeturn3view0 Source: click({invocation}); no target rendered"
            + "-" * 80
            + f"www.linkedin.com ({target})\nciteturn8view0 Source: click({other_invocation}); unrelated target"
        )
        counts, status, _, stored = self._import_legacy_packet(find_doc, click_doc)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertFalse(stored["legacy_click_binding"]["verified"])

    def test_legacy_adapter_does_not_treat_redirect_destination_as_original_href(self):
        find_doc, click_doc, target, _ = self._legacy_capture_docs()
        invocation = json.dumps({"ref_id": "turn2view0", "id": 11}, separators=(",", ":"))
        click_doc["web"] = (
            f"citeturn3view0 Source: click({invocation}); "
            f"Redirected to URL: {target}"
        )
        counts, status, _, stored = self._import_legacy_packet(find_doc, click_doc)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertFalse(stored["legacy_click_binding"]["verified"])
        self.assertNotIn("raw_href", stored["legacy_click_binding"])

    def test_legacy_adapter_does_not_bleed_cta_across_inline_80_dash_separator(self):
        find_doc, click_doc, _, _ = self._legacy_capture_docs()
        first_page = find_doc["findings"].replace("【11†View all 42 employees】", "【11†Follow】")
        find_doc["findings"] = (
            first_page + "-" * 80
            + "L22: * 【11†View all 42 employees】 "
            + "citeturn9view0 Source: find({\"ref_id\":\"turn1view0\",\"pattern\":\"View all\"}); Total lines: 10"
        )
        counts, status, _, stored = self._import_legacy_packet(find_doc, click_doc)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertFalse(stored["legacy_click_binding"]["verified"])
        self.assertEqual(stored["identity"], {})

    def test_legacy_adapter_rejects_host_spoof_and_multi_id_facet(self):
        for bad_target in (
            self._employee_target().replace("www.linkedin.com/signup", "www.linkedin.com.attacker.example/signup"),
            "https://www.linkedin.com/signup/cold-join?session_redirect="
            "https%3A%2F%2Fwww.linkedin.com%2Fsearch%2Fresults%2Fpeople%2F"
            "%3FfacetCurrentCompany%3D%255B123456%252C789012%255D",
        ):
            with self.subTest(target=bad_target[:50]):
                find_doc, click_doc, _, _ = self._legacy_capture_docs()
                click_doc["web"] = click_doc["web"].replace(self._employee_target(), bad_target)
                counts, status, _, stored = self._import_legacy_packet(find_doc, click_doc)
                self.assertEqual(counts["exceptions"], 1)
                self.assertEqual(status, "exception")
                self.assertFalse(stored["legacy_click_binding"]["verified"])

    def test_legacy_adapter_rejects_candidate_id_not_matching_raw_href(self):
        find_doc, click_doc, _, _ = self._legacy_capture_docs()
        counts, status, _, stored = self._import_legacy_packet(find_doc, click_doc, proposed_id="999999")
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertFalse(stored["legacy_click_binding"]["verified"])
        self.assertEqual(stored["legacy_click_binding"]["linkedin_org_id"], "123456")

    def test_legacy_adapter_rejects_caller_id_or_raw_queue_target_mismatch(self):
        find_doc, click_doc, target, _ = self._legacy_capture_docs(queue_overrides={
            "target_url": self._employee_target("999999"),
            "facetCurrentCompany_ids": ["999999"],
        })
        counts, status, _, stored = self._import_legacy_packet(find_doc, click_doc)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertFalse(stored["legacy_click_binding"]["verified"])
        self.assertNotEqual(stored.get("legacy_click_binding", {}).get("raw_href"), target)

    def test_legacy_adapter_keeps_exact_wrapped_429_as_destination_cooldown(self):
        find_doc, click_doc, target, _ = self._legacy_capture_docs()
        invocation = json.dumps({"ref_id": "turn2view0", "id": 11}, separators=(",", ":"))
        click_doc["web"] = (
            f"citeturn3view0 Source: click({invocation}); "
            f"Failed to fetch <{target}>: (429) Too Many Requests"
        )
        counts, status, reason, stored = self._import_legacy_packet(find_doc, click_doc)
        self.assertEqual(counts["imported"], 1)
        self.assertEqual(status, "valid_pending_review")
        self.assertIsNone(reason)
        self.assertTrue(stored["legacy_click_binding"]["verified"])
        self.assertEqual(stored["legacy_click_binding"]["linkedin_org_id"], "123456")
        self.assertEqual(stored["destination_access_status"], "deferred_cooldown")
        self.assertEqual(stored["source_access"]["status"], "content_observed")
        self.assertEqual(stored["identity"]["observed_company_name"], "Acme Systems")
        self.assertNotIn("http_status", stored)
        self.assertEqual(wrapped_transport_status(stored), 429)

    def test_legacy_missing_click_file_is_saved_as_an_exception_without_fake_status(self):
        find_doc, click_doc, _, _ = self._legacy_capture_docs()
        counts, status, _, stored = self._import_legacy_packet(
            find_doc, click_doc, evidence_overrides={"raw_click_file": "missing-click.json", "http_status": 200}
        )
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertFalse(stored["legacy_click_binding"]["verified"])
        self.assertEqual(stored["source_access"]["status"], "content_observed")
        self.assertNotIn("http_status", stored)
        self.assertEqual(stored["identity"]["observed_company_name"], "Acme Systems")

    def test_legacy_linkedin_adapter_rejects_stale_ref_or_target_pair(self):
        evidence_root = self.root / "evidence"
        evidence_root.mkdir(mode=0o700); os.chmod(evidence_root, 0o700)
        target = "https://www.linkedin.com/company/123456/"
        find_doc = {"rows": [{"company_key": "acme", "company_name": "Acme Systems", "source_ref": "turn1view0",
                              "requested_url": "https://www.linkedin.com/company/acme/", "title": "Acme Systems | LinkedIn", "profile_name": "Acme Systems"}],
                    "findings": [{"ref": "turn2view0"}]}
        click_doc = {"queue": [{"company_key": "acme", "existing_page_ref": "turn9view0", "find_result_ref": "turn2view0", "employee_link_id": 11}], "web": "clicked " + target}
        (evidence_root / "find.json").write_text(json.dumps(find_doc), encoding="utf-8")
        (evidence_root / "click.json").write_text(json.dumps(click_doc), encoding="utf-8")
        conn = open_state(self.state)
        packet = {"candidates": [{"company_key": "acme", "fields": {"linkedin_org_id": "123456"}, "expected": {"linkedin_org_id": None},
            "evidence": {"linkedin_org_id": {"raw_find_file": "find.json", "raw_click_file": "click.json", "primary_page_ref": "turn1view0",
                "find_result_ref": "turn2view0", "employee_link_id": 11, "primary_href": "https://www.linkedin.com/company/acme/jobs/", "url": target, "facetCurrentCompany_ids": ["123456"],
                "profile_name": "Acme Systems", "profile_website": "https://acme.example", "official_website_url": "https://acme.example"}}}]}
        self.assertEqual(import_packet(conn, packet, evidence_root=evidence_root)["exceptions"], 1)
        evidence = json.loads(conn.execute("SELECT evidence_json FROM proposals").fetchone()[0])
        self.assertFalse(evidence["legacy_click_binding"]["verified"])
        conn.close()

    def _import_career_source_and_destination(self, target="https://acme.example/careers",
                                              destination_records=None, destination_file=True,
                                              source_overrides=None, preceding_source_records=None):
        evidence_root = self.root / "career-evidence"
        evidence_root.mkdir(mode=0o700, exist_ok=True)
        os.chmod(evidence_root, 0o700)
        source_row = {
            "requested_url": "https://acme.example/about",
            "status": 200,
            "final_url": "https://acme.example/about",
            "title": "Acme Systems",
            "company_keys": ["acme"],
            "careers_links": [{"url": target, "label": "Careers", "footer": True, "nav": False}],
        }
        if source_overrides:
            source_row.update(source_overrides)
        preceding_source_records = preceding_source_records or []
        source_records = preceding_source_records + [source_row]
        source_line_number = len(source_records)
        jsonl_text = "\n".join(json.dumps(record, ensure_ascii=False) for record in source_records) + "\n"
        (evidence_root / "footer.jsonl").write_text(jsonl_text, encoding="utf-8")
        if destination_records is None:
            destination_records = [{
                "requested_url": target,
                "final_url": target,
                "status": 200,
                "title": "Acme Systems Careers",
                "company_keys": ["acme"],
                "body_truncated": False,
                "careers_links": [],
            }]
        if destination_file:
            (evidence_root / "destinations.json").write_text(json.dumps(destination_records), encoding="utf-8")
        packet = {
            "patches": [{
                "company_key": "acme",
                "fields": {"careers_url": target},
                "expected": {"careers_url": "https://old.acme.example/careers"},
                "evidence": {"careers_url": {
                    "source_file": "footer.jsonl",
                    "line": source_line_number,
                    "url": "https://acme.example/about",
                    "excerpt": "Careers",
                }},
            }]
        }
        conn = open_state(self.state)
        try:
            counts = import_packet(
                conn, packet, evidence_root=evidence_root,
                destination_checks_file="destinations.json" if destination_file else None,
            )
            proposal = conn.execute(
                "SELECT validation_status,validation_reason,evidence_json,approved FROM proposals"
            ).fetchone()
            return counts, proposal["validation_status"], proposal["validation_reason"], json.loads(proposal["evidence_json"]), proposal["approved"]
        finally:
            conn.close()

    def test_careers_source_and_exact_destination_capture_create_general_portal_candidate(self):
        counts, status, reason, saved, approved = self._import_career_source_and_destination()
        self.assertEqual(counts["imported"], 1)
        self.assertEqual(status, "valid_pending_review")
        self.assertIsNone(reason)
        self.assertFalse(approved)
        self.assertEqual(saved["source_access"]["status"], "content_observed")
        self.assertEqual(saved["identity"]["observed_company_name"], "Acme Systems")
        self.assertEqual(saved["destination_access_status"], "available")
        self.assertEqual(saved["careers_scope"], "general_jobs_portal")
        self.assertNotEqual(saved["careers_scope"], "companywide_general_jobs")
        self.assertEqual(saved["destination_check_evidence"]["status"], 200)
        self.assertEqual(len(saved["destination_check_evidence"]["file_sha256"]), 64)
        self.assertEqual(len(saved["destination_check_evidence"]["record_sha256"]), 64)
        self.assertIn("Careers", saved["careers_scope_excerpt"])
        self.assertIn("Acme Systems Careers", saved["careers_scope_excerpt"])

    def test_jsonl_line_index_counts_lf_only_not_u2028(self):
        preceding = [{
            "requested_url": "https://other.example/about",
            "status": 200,
            "title": "Other Systems",
            "company_keys": ["other"],
            "notes": "before\u2028after",
            "careers_links": [],
        }]
        counts, status, reason, saved, approved = self._import_career_source_and_destination(
            preceding_source_records=preceding
        )
        self.assertEqual(counts["imported"], 1)
        self.assertEqual(status, "valid_pending_review")
        self.assertIsNone(reason)
        self.assertFalse(approved)
        self.assertEqual(saved["raw_line_number"], 2)
        self.assertEqual(saved["legacy_corporate_binding"]["company_key_match"], True)
        self.assertEqual(saved["legacy_corporate_binding"]["target_href_match"], True)
        self.assertEqual(saved["careers_scope"], "general_jobs_portal")

    def test_careers_source_line_company_key_mismatch_is_adapter_gap(self):
        counts, status, reason, saved, _ = self._import_career_source_and_destination(
            source_overrides={"company_keys": ["another-company"]}
        )
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertEqual(reason, "adapter_gap:careers_source_line_binding_unverified")
        self.assertEqual(saved["source_access"]["status"], "unknown")
        self.assertNotIn("careers_scope", saved)

    def test_careers_source_without_company_title_stays_adapter_gap(self):
        counts, status, reason, saved, _ = self._import_career_source_and_destination(
            source_overrides={"title": ""}
        )
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertEqual(reason, "adapter_gap:careers_source_line_binding_unverified")
        self.assertEqual(saved["source_access"]["status"], "unknown")
        self.assertNotIn("identity", saved)
        self.assertNotIn("careers_scope", saved)

    def test_careers_source_line_url_mismatch_is_adapter_gap(self):
        counts, status, reason, saved, _ = self._import_career_source_and_destination(
            source_overrides={"requested_url": "https://different.example/about",
                              "final_url": "https://different.example/about"}
        )
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertEqual(reason, "adapter_gap:careers_source_line_binding_unverified")
        self.assertEqual(saved["source_access"]["status"], "unknown")
        self.assertNotIn("careers_scope", saved)

    def test_careers_destination_check_must_match_the_same_company_key(self):
        target = "https://acme.example/careers"
        destination = [{
            "requested_url": target, "final_url": target, "status": 200, "title": "Acme Systems Careers",
            "company_keys": ["another-company"], "careers_links": [],
        }]
        counts, status, reason, saved, _ = self._import_career_source_and_destination(
            target=target, destination_records=destination
        )
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertEqual(reason, "adapter_gap:careers_destination_check_missing_or_ambiguous")
        self.assertNotIn("careers_scope", saved)

    def test_careers_destination_path_redirect_remains_unverified(self):
        target = "https://acme.example/careers"
        destination = [{
            "requested_url": target, "final_url": "https://jobs.acme.example/careers",
            "status": 200, "title": "Acme Systems Careers", "company_keys": ["acme"], "careers_links": [],
        }]
        counts, status, reason, saved, _ = self._import_career_source_and_destination(
            target=target, destination_records=destination
        )
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertEqual(reason, "adapter_gap:careers_destination_redirect_unverified")
        self.assertEqual(saved["destination_access_status"], "available")
        self.assertNotIn("careers_scope", saved)

    def test_careers_429_destination_stays_cooldown_and_source_stays_observed(self):
        target = "https://acme.example/careers"
        destination = [{
            "requested_url": target, "final_url": None, "status": 429, "retry_after": "30",
            "title": None, "company_keys": ["acme"], "careers_links": [],
        }]
        counts, status, reason, saved, _ = self._import_career_source_and_destination(
            target=target, destination_records=destination
        )
        self.assertEqual(counts["deferred"], 1)
        self.assertEqual(status, "deferred_cooldown")
        self.assertEqual(reason, "wrapped_http_429_retry_after_required")
        self.assertEqual(saved["source_access"]["status"], "content_observed")
        self.assertEqual(saved["http_status"], 200)
        self.assertEqual(saved["destination_access_status"], "cooldown_pending")
        self.assertEqual(saved["destination_retry_after_seconds"], 30)
        self.assertNotIn("careers_scope", saved)

    def test_locale_path_needs_explicit_global_scope_evidence(self):
        target = "https://acme.example/us/careers"
        counts, status, reason, saved, _ = self._import_career_source_and_destination(target=target)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertEqual(reason, "adapter_gap:careers_regional_scope_unverified")
        self.assertNotIn("careers_scope", saved)

    def test_emea_region_prefix_requires_explicit_global_evidence(self):
        target = "https://acme.example/emea/careers"
        counts, status, reason, saved, _ = self._import_career_source_and_destination(target=target)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertEqual(reason, "adapter_gap:careers_regional_scope_unverified")
        self.assertNotIn("careers_scope", saved)

    def test_language_region_prefix_requires_explicit_global_evidence(self):
        target = "https://acme.example/en-us/careers"
        counts, status, reason, saved, _ = self._import_career_source_and_destination(target=target)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertEqual(reason, "adapter_gap:careers_regional_scope_unverified")
        self.assertNotIn("careers_scope", saved)

    def test_unknown_route_prefix_is_not_assumed_general(self):
        target = "https://acme.example/region-west/careers"
        counts, status, reason, saved, _ = self._import_career_source_and_destination(target=target)
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "exception")
        self.assertEqual(reason, "adapter_gap:careers_regional_scope_unverified")
        self.assertNotIn("careers_scope", saved)

    def test_emea_route_with_explicit_global_link_is_companywide(self):
        target = "https://acme.example/emea/careers"
        destination = [{
            "requested_url": target, "final_url": target, "status": 200,
            "title": "Acme Systems Careers", "company_keys": ["acme"],
            "careers_links": [{"url": "https://acme.example/careers/all", "label": "Global jobs"}],
        }]
        counts, status, reason, saved, _ = self._import_career_source_and_destination(
            target=target, destination_records=destination
        )
        self.assertEqual(counts["imported"], 1)
        self.assertEqual(status, "valid_pending_review")
        self.assertIsNone(reason)
        self.assertEqual(saved["careers_scope"], "companywide_general_jobs")

    def test_en_us_route_with_explicit_global_title_is_companywide(self):
        target = "https://acme.example/en-us/careers"
        destination = [{
            "requested_url": target, "final_url": target, "status": 200,
            "title": "Acme Systems Global Careers", "company_keys": ["acme"], "careers_links": [],
        }]
        counts, status, reason, saved, _ = self._import_career_source_and_destination(
            target=target, destination_records=destination
        )
        self.assertEqual(counts["imported"], 1)
        self.assertEqual(status, "valid_pending_review")
        self.assertIsNone(reason)
        self.assertEqual(saved["careers_scope"], "companywide_general_jobs")

    def test_locale_path_can_use_explicit_global_destination_link(self):
        target = "https://acme.example/us/careers"
        destination = [{
            "requested_url": target, "final_url": target, "status": 200,
            "title": "Acme Systems Careers", "company_keys": ["acme"],
            "careers_links": [{"url": "https://acme.example/careers/all", "label": "Global jobs"}],
        }]
        counts, status, reason, saved, _ = self._import_career_source_and_destination(
            target=target, destination_records=destination
        )
        self.assertEqual(counts["imported"], 1)
        self.assertEqual(status, "valid_pending_review")
        self.assertIsNone(reason)
        self.assertEqual(saved["careers_scope"], "companywide_general_jobs")

    def test_legacy_source_file_line_adapter_binds_exact_careers_href(self):
        evidence_root = self.root / "evidence"
        evidence_root.mkdir(mode=0o700); os.chmod(evidence_root, 0o700)
        row = {"requested_url": "https://acme.example/about", "status": 200, "final_url": "https://acme.example/about",
               "title": "Acme Systems", "company_keys": ["acme"], "careers_links": [{"url": "https://acme.example/careers", "label": "Careers"}]}
        (evidence_root / "footer.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
        conn = open_state(self.state)
        packet = {"patches": [{"company_key": "acme", "fields": {"careers_url": "https://acme.example/careers"},
            "expected": {"careers_url": "https://old.acme.example/careers"}, "evidence": {"careers_url": {
                "source_file": "../footer.jsonl", "line": 1, "url": "https://acme.example/about", "excerpt": "Acme Systems"}}}]}
        self.assertEqual(import_packet(conn, packet, evidence_root=evidence_root)["exceptions"], 1)
        proposal = conn.execute("SELECT validation_reason,evidence_json FROM proposals").fetchone()
        saved = json.loads(proposal["evidence_json"])
        self.assertEqual(saved["http_status"], 200)
        self.assertTrue(saved["legacy_corporate_binding"]["company_key_match"])
        self.assertTrue(saved["legacy_corporate_binding"]["source_url_match"])
        self.assertTrue(saved["legacy_corporate_binding"]["source_title_match"])
        self.assertTrue(saved["legacy_corporate_binding"]["target_href_match"])
        self.assertEqual(saved["raw_line_number"], 1)
        self.assertNotIn("careers_scope", saved)
        self.assertEqual(proposal["validation_reason"], "adapter_gap:careers_destination_checks_missing")
        conn.close()

    def test_synthetic_30k_benchmark_uses_sqlite_queue_cache_and_restart(self):
        result = benchmark_synthetic(30000)
        self.assertEqual(result["mode"], "synthetic_offline_sqlite_queue_cache_only")
        self.assertEqual(result["first_enqueue"], 30000)
        self.assertEqual(result["duplicate_replay_deduplicated"], 30000)
        self.assertEqual(result["resumed_by_stable_id"], 29960)
        self.assertTrue(result["exact_reconciliation_complete"])
        self.assertEqual(result["cache_hits"], 30000)
        self.assertEqual(result["network_requests"], 0)


FULL_FIELDS_FOR_TEST = ("website_url", "careers_url", "linkedin_url", "linkedin_org_id", "geo", "industry", "domain_group")


def task_id_for_test(task):
    from cli import task_id
    return task_id(task)


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.row = full_row()
        self.baseline_file = self.root / "baseline.json"
        self.baseline_file.write_text(json.dumps([self.row]), encoding="utf-8")
        self.state = self.root / "state.sqlite"
        init_state(self.state, self.baseline_file)
        self.db = self.root / "prod.sqlite"
        self.make_database()
        self.backups = self.root / "backups"
        conn = open_state(self.state)
        packet = {"updates": [{"company_key": "acme", "fields": {"website_url": "https://acme.example"},
                              "expected": {"website_url": "https://old.acme.example"}, "evidence": {"website_url": good_evidence()}}]}
        import_packet(conn, packet)
        proposal = conn.execute("SELECT * FROM proposals").fetchone()
        approve_candidate(conn, proposal["candidate_id"], "qa-reviewer", candidate_hash(proposal))
        conn.close()

    def tearDown(self):
        self.temp.cleanup()

    def make_database(self):
        conn = sqlite3.connect(self.db)
        cols = ", ".join(f'"{col}" TEXT' + (" PRIMARY KEY" if col == "company_key" else "") for col in FULL_COLUMNS)
        conn.execute(f"CREATE TABLE company_directory ({cols})")
        conn.execute(f"INSERT INTO company_directory ({','.join(FULL_COLUMNS)}) VALUES ({','.join('?' for _ in FULL_COLUMNS)})", [self.row[k] for k in FULL_COLUMNS])
        conn.commit(); conn.close()

    def read_db(self):
        conn = sqlite3.connect(self.db)
        row = dict(zip(FULL_COLUMNS, conn.execute("SELECT * FROM company_directory").fetchone()))
        conn.close()
        return row

    def test_apply_defaults_to_dry_run_then_preserves_non_target_fields(self):
        conn = open_state(self.state)
        dry = apply_approved(conn, self.db, self.backups)
        self.assertEqual(dry["mode"], "dry_run")
        self.assertEqual(self.read_db()["website_url"], "https://old.acme.example")
        manifest = make_approved_manifest(conn)
        applied = apply_approved(conn, self.db, self.backups, apply=True, confirmed_sha=sha256_value([self.row]),
                                 manifest=manifest, confirmed_manifest_sha=manifest["manifest_sha256"])
        self.assertEqual(applied["mode"], "apply")
        after = self.read_db()
        self.assertEqual(after["website_url"], "https://acme.example")
        self.assertEqual(after["notes"], "private note")
        self.assertEqual(after["status"], "active")
        backup = Path(applied["before_image"])
        self.assertTrue(backup.exists())
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        conn.close()

    def test_concurrent_non_target_edit_refuses_without_overwriting(self):
        live = sqlite3.connect(self.db)
        live.execute("UPDATE company_directory SET notes='concurrent edit' WHERE company_key='acme'")
        live.commit(); live.close()
        conn = open_state(self.state)
        with self.assertRaisesRegex(ValueError, "live full-row snapshot differs"):
            manifest = make_approved_manifest(conn)
            apply_approved(conn, self.db, self.backups, apply=True, confirmed_sha=sha256_value([self.row]),
                           manifest=manifest, confirmed_manifest_sha=manifest["manifest_sha256"])
        self.assertEqual(self.read_db()["notes"], "concurrent edit")
        self.assertEqual(self.read_db()["website_url"], "https://old.acme.example")
        conn.close()

    def test_manifest_hash_binds_exact_reviewed_candidate_set(self):
        conn = open_state(self.state)
        manifest = make_approved_manifest(conn)
        manifest["updates"][0]["fields"]["website_url"] = "https://attacker.example"
        with self.assertRaisesRegex(ValueError, "manifest content hash"):
            apply_approved(conn, self.db, self.backups, apply=True, confirmed_sha=sha256_value([self.row]),
                           manifest=manifest, confirmed_manifest_sha=manifest["manifest_sha256"])
        conn.close()

    def test_trigger_cannot_change_non_proposed_allowed_field(self):
        live = sqlite3.connect(self.db)
        live.execute("CREATE TRIGGER mutate_industry AFTER UPDATE OF website_url ON company_directory BEGIN UPDATE company_directory SET industry='unexpected' WHERE company_key='acme'; END")
        live.commit(); live.close()
        conn = open_state(self.state)
        manifest = make_approved_manifest(conn)
        with self.assertRaisesRegex(ValueError, "non-target field changed: acme.industry"):
            apply_approved(conn, self.db, self.backups, apply=True, confirmed_sha=sha256_value([self.row]),
                           manifest=manifest, confirmed_manifest_sha=manifest["manifest_sha256"])
        self.assertEqual(self.read_db()["website_url"], "https://old.acme.example")
        self.assertEqual(self.read_db()["industry"], None)
        conn.close()

    def test_trigger_failure_rolls_back_target_update(self):
        live = sqlite3.connect(self.db)
        live.execute("CREATE TRIGGER reject_update BEFORE UPDATE ON company_directory BEGIN SELECT RAISE(ABORT, 'blocked'); END")
        live.commit(); live.close()
        conn = open_state(self.state)
        with self.assertRaises(sqlite3.IntegrityError):
            manifest = make_approved_manifest(conn)
            apply_approved(conn, self.db, self.backups, apply=True, confirmed_sha=sha256_value([self.row]),
                           manifest=manifest, confirmed_manifest_sha=manifest["manifest_sha256"])
        self.assertEqual(self.read_db()["website_url"], "https://old.acme.example")
        conn.close()


if __name__ == "__main__":
    unittest.main()
