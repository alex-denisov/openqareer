import json
import os
import sqlite3
import tempfile
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
        counts, status, reason, stored = self._import_legacy_packet(find_doc, click_doc)

        self.assertEqual(counts["imported"], 1)
        self.assertEqual(status, "valid_pending_review")
        self.assertIsNone(reason)
        self.assertTrue(stored["legacy_click_binding"]["verified"])
        self.assertEqual(stored["legacy_click_binding"]["linkedin_org_id"], "123456")
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
        self.assertEqual(counts["exceptions"], 1)
        self.assertEqual(status, "deferred_cooldown")
        self.assertEqual(reason, "wrapped_http_429_retry_after_required")
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
