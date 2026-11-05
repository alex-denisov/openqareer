#!/usr/bin/env python3
"""
Deep Career Portal Resolution Pipeline for OpenQareer (Veselova 634 dataset).

Strict Priority Order:
1. Own corporate career portal/section (careers.domain, domain/careers, Next.js, Framer, Astro, HTML, or ATS embed).
   Canonical URL is ALWAYS the company's own domain (e.g. plata.careers, databricks.com/company/careers).
2. Direct ATS board (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, BambooHR, Personio) ONLY if no own-site portal exists.
3. LinkedIn Company Guest (seeMoreJobPostings) ONLY if no own-site portal or ATS board exists.
4. Active Tracking / 0 Current Vacancies (kept in registry, not excluded).
"""
import concurrent.futures
import functools
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import openpyxl

print = functools.partial(print, flush=True)

socket.setdefaulttimeout(3.5)

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36"
)

PROBE_UA = "openqareer-probe/1.0 (+https://openqareer.com; career source verification)"

GEO_TLD_MAP = {
    'mexico': ['mx', 'com.mx'],
    'germany': ['de'],
    'united kingdom': ['co.uk', 'uk'],
    'uk': ['co.uk', 'uk'],
    'cyprus': ['com.cy', 'cy'],
    'spain': ['es'],
    'netherlands': ['nl'],
    'uae': ['ae'],
    'dubai': ['ae'],
    'singapore': ['sg', 'com.sg'],
    'armenia': ['am'],
    'georgia': ['ge'],
    'serbia': ['rs'],
    'turkey': ['com.tr', 'tr'],
    'brazil': ['com.br', 'br'],
    'france': ['fr'],
    'israel': ['co.il', 'il'],
    'canada': ['ca'],
    'australia': ['com.au', 'au'],
    'poland': ['pl'],
    'czech': ['cz'],
    'switzerland': ['ch'],
    'austria': ['at'],
    'portugal': ['pt'],
}

ATS_PATTERNS = [
    (r'jobs\.ashbyhq\.com/([a-zA-Z0-9._-]+)', 'ashby'),
    (r'boards\.greenhouse\.io/([a-zA-Z0-9._-]+)', 'greenhouse'),
    (r'job-boards\.greenhouse\.io/([a-zA-Z0-9._-]+)', 'greenhouse'),
    (r'jobs\.lever\.co/([a-zA-Z0-9._-]+)', 'lever'),
    (r'apply\.workable\.com/([a-zA-Z0-9._-]+)', 'workable'),
    (r'([a-zA-Z0-9-]+)\.recruitee\.com', 'recruitee'),
    (r'jobs\.smartrecruiters\.com/([a-zA-Z0-9._-]+)', 'smartrecruiters'),
    (r'([a-zA-Z0-9-]+)\.breezy\.hr', 'breezy'),
    (r'([a-zA-Z0-9-]+)\.pinpointhq\.com', 'pinpoint'),
    (r'([a-zA-Z0-9-]+)\.jobs\.personio\.de', 'personio'),
    (r'([a-zA-Z0-9-]+)\.bamboohr\.com', 'bamboohr'),
]

ATS_API_PROBES = {
    'greenhouse': lambda s: (f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs", lambda d: len(d.get("jobs") or [])),
    'lever': lambda s: (f"https://api.lever.co/v0/postings/{s}?mode=json", lambda d: len(d) if isinstance(d, list) else 0),
    'ashby': lambda s: (f"https://api.ashbyhq.com/posting-api/job-board/{s}", lambda d: len(d.get("jobs") or [])),
    'workable': lambda s: (f"https://apply.workable.com/api/v1/widget/accounts/{s}?details=true", lambda d: len(d.get("jobs") or [])),
    'recruitee': lambda s: (f"https://{s}.recruitee.com/api/offers/", lambda d: len(d.get("offers") or [])),
    'smartrecruiters': lambda s: (f"https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=50", lambda d: len(d.get("content") or d.get("postings") or [])),
    'breezy': lambda s: (f"https://{s}.breezy.hr/json", lambda d: len(d) if isinstance(d, list) else 0),
    'bamboohr': lambda s: (f"https://{s}.bamboohr.com/careers/list", lambda d: len(d.get("result") or [])),
    'personio': lambda s: (f"https://{s}.jobs.personio.de/xml", lambda b: len(re.findall(r'<position>', b))),
}

def norm(s):
    if not s: return ''
    return re.sub(r'[^a-z0-9]', '', str(s).lower())

def fetch_url(url, timeout=3.0, max_bytes=250000):
    req = urllib.request.Request(url, headers={
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8,ru;q=0.7'
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as res:
            final_url = res.geturl()
            body = res.read(max_bytes).decode('utf-8', errors='ignore')
            return res.status, final_url, body
    except urllib.error.HTTPError as e:
        return e.code, url, ''
    except Exception:
        return None, url, ''

def dns_resolves(host):
    try:
        socket.gethostbyname(host)
        return True
    except:
        return False

def extract_ats_from_html(url, html):
    for pat, prov in ATS_PATTERNS:
        m = re.search(pat, url)
        if m: return prov, m.group(1)
    for pat, prov in ATS_PATTERNS:
        m = re.search(pat, html)
        if m: return prov, m.group(1)
    return None, None

def probe_ats_api(provider, slug):
    if provider not in ATS_API_PROBES:
        return 0
    url_fn = ATS_API_PROBES[provider]
    url, count_fn = url_fn(slug)
    req = urllib.request.Request(url, headers={'User-Agent': PROBE_UA, 'Accept': '*/*'})
    try:
        with urllib.request.urlopen(req, timeout=3.0, context=ctx) as res:
            if res.status != 200:
                return 0
            body = res.read()
            if provider == 'personio':
                return count_fn(body.decode('utf-8', 'ignore'))
            data = json.loads(body.decode('utf-8', 'ignore'))
            return count_fn(data)
    except Exception:
        return 0

def probe_linkedin_guest(company_name):
    query = urllib.parse.quote(company_name)
    url = f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={query}&start=0"
    req = urllib.request.Request(url, headers={'User-Agent': BROWSER_UA, 'Accept': 'text/html'})
    try:
        with urllib.request.urlopen(req, timeout=3.5, context=ctx) as res:
            if res.status != 200:
                return 0, []
            html = res.read().decode('utf-8', errors='ignore')
            titles = re.findall(r'<h3 class="base-search-card__title">([^<]+)</h3>', html)
            matching = [t.strip() for t in titles if t.strip()]
            return len(matching), matching
    except Exception:
        return 0, []

def generate_smart_domain_candidates(company_name, notes, geo):
    name_clean = re.sub(r'[^a-zA-Z0-9\s.-]', '', company_name).strip()
    slug = norm(name_clean)
    words = [norm(w) for w in name_clean.split() if len(w) > 1]
    
    candidates = []
    
    # 1. Notes extraction
    if notes:
        m_dom = re.findall(r'\b([a-zA-Z0-9-]+\.(?:com|ai|io|app|co|tech|cloud|org|net|careers|mx|de|uk|nl|es|ae|am|ge|rs|ch|fr))\b', notes)
        for d in m_dom:
            candidates.append(d.lower())
        m_alias = re.search(r'бывшая\s+([A-Za-z0-9]+)', notes)
        if m_alias:
            aslug = norm(m_alias.group(1))
            candidates.extend([f"{aslug}.ai", f"{aslug}.com", f"{aslug}.io"])

    # 2. Dedicated careers domain
    if len(words) > 0:
        candidates.append(f"{words[0]}.careers")
        candidates.append(f"{slug}.careers")

    # 3. Country-specific TLDs based on geo
    geo_lower = (geo or '').lower()
    for geo_key, tlds in GEO_TLD_MAP.items():
        if geo_key in geo_lower:
            for tld in tlds:
                candidates.append(f"{slug}.{tld}")
                if len(words) > 1:
                    candidates.append(f"{words[0]}.{tld}")

    # 4. Standard tech TLDs
    for tld in ['com', 'ai', 'io', 'co', 'app', 'cloud', 'tech', 'net', 'org']:
        candidates.append(f"{slug}.{tld}")
        if len(words) > 1 and len(words[0]) >= 3:
            candidates.append(f"{words[0]}.{tld}")

    seen = set()
    deduped = []
    for d in candidates:
        if d not in seen:
            seen.add(d)
            deduped.append(d)
    return deduped

def extract_job_count_and_sample(html, base_url):
    # Check for direct job links
    job_patterns = [
        r'href=[\"\']([^\"\']*(?:/career-opening/|/job-details/|/vacancy/|/jobs?/|/careers?/|details\?id=)[^\"\']*)[\"\']',
        r'href=[\"\']([^\"\']*(?:ashbyhq\.com|greenhouse\.io|lever\.co|workable\.com|recruitee\.com|smartrecruiters\.com)[^\"\']*)[\"\']',
    ]
    links = set()
    for p in job_patterns:
        for m in re.finditer(p, html, re.I):
            href = m.group(1).strip()
            # Ignore self-links
            if href.endswith('/careers') or href.endswith('/jobs') or href == base_url or len(href) < 8:
                continue
            links.add(href)
    
    # Check Next.js SSR
    if '__NEXT_DATA__' in html and ('job' in html.lower() or 'career' in html.lower()):
        # Try counting job objects
        job_matches = len(re.findall(r'\"(?:jobTitle|title|role)\"\s*:\s*\"([^\"]+)\"', html))
        return max(job_matches, len(links), 1), list(links)[:3]

    # Check Schema.org JobPosting
    schema_postings = len(re.findall(r'schema\.org/(?:JobPosting)', html))
    if schema_postings > 0:
        return max(schema_postings, len(links)), list(links)[:3]

    return len(links), list(links)[:3]

def resolve_company_deep(company):
    name = company['name']
    notes = company.get('notes', '')
    geo = company.get('geo', '')
    slug = norm(name)

    candidate_domains = generate_smart_domain_candidates(name, notes, geo)
    live_domain = None

    # Step 1: Deep Probe for Own Corporate Career Portal
    for dom in candidate_domains:
        if not dns_resolves(dom):
            continue
        live_domain = dom

        # Check common paths on live domain
        # 1. Fetch homepage to inspect navigation links
        h_status, h_url, h_html = fetch_url(f"https://{dom}", timeout=3.0)
        career_links = []
        if h_status in (200, 301, 302, 307, 308) and h_html:
            # Find all links mentioning careers, jobs, vacancies, join-us
            for m in re.finditer(r'href=[\"\']([^\"\']+)[\"\']', h_html, re.I):
                href = m.group(1).strip()
                if any(k in href.lower() for k in ['career', 'job', 'vacanc', 'join-us', 'work-with-us', 'unete', 'trabaj', 'equipo']):
                    if href.startswith('/'):
                        href = f"https://{dom}{href}"
                    elif href.startswith('./'):
                        href = f"https://{dom}/{href[2:]}"
                    elif not href.startswith('http'):
                        href = f"https://{dom}/{href}"
                    career_links.append(href)

        # Standard direct paths to test
        direct_paths = [
            f"https://{dom}/careers",
            f"https://{dom}/jobs",
            f"https://{dom}/company/careers",
            f"https://{dom}/about/careers",
            f"https://{dom}/vacancy",
            f"https://{dom}/vacancies",
            f"https://{dom}/career",
            f"https://{dom}/company#career",
            f"https://careers.{dom}",
            f"https://jobs.{dom}"
        ]

        probe_urls = list(dict.fromkeys(career_links[:3] + direct_paths))

        for cu in probe_urls:
            c_status, c_url, c_html = fetch_url(cu, timeout=3.0)
            if c_status in (200, 301, 302, 307, 308) and c_html:
                # Is it an actual career page?
                has_career_intent = any(w in c_html.lower() for w in [
                    'open position', 'current openings', 'join our team', 'work with us',
                    'careers', 'vacancies', 'vacantes', 'job openings', 'explore opportunities',
                    'career-opening', 'schema.org/jobposting'
                ])
                if has_career_intent:
                    cnt, samples = extract_job_count_and_sample(c_html, c_url)
                    ats_prov, ats_slug = extract_ats_from_html(c_url, c_html)
                    
                    sub_type = 'corporate_html'
                    if '__NEXT_DATA__' in c_html:
                        sub_type = 'next_data'
                    elif ats_prov and ats_slug:
                        sub_type = f"ats_embed_{ats_prov}"

                    return {
                        'num': company['num'],
                        'company': name,
                        'tier': 'Priority 1 (Own site career portal)',
                        'type': sub_type,
                        'domain': dom,
                        'career_url': c_url,
                        'jobs': cnt if cnt > 0 else 1,
                        'sample_job': samples[0] if samples else c_url,
                        'notes': notes,
                        'ats_provider': ats_prov,
                        'ats_slug': ats_slug
                    }
        break # Checked primary live domain

    # Step 2: Direct ATS Board Probe (ONLY if no own-site portal found)
    for ats_slug in [slug, f"{slug}ai", f"{slug}tech"]:
        for prov in ['greenhouse', 'ashby', 'lever', 'workable', 'smartrecruiters', 'recruitee', 'bamboohr', 'personio']:
            cnt = probe_ats_api(prov, ats_slug)
            if cnt > 0:
                return {
                    'num': company['num'],
                    'company': name,
                    'tier': 'Priority 2 (Direct ATS board)',
                    'type': 'ats_board',
                    'provider': prov,
                    'slug': ats_slug,
                    'domain': live_domain or f"{slug}.com",
                    'career_url': f"https://{prov}.com/{ats_slug}",
                    'jobs': cnt,
                    'notes': notes
                }

    # Step 3: LinkedIn Company Guest Probe
    li_cnt, li_titles = probe_linkedin_guest(name)
    if li_cnt > 0:
        return {
            'num': company['num'],
            'company': name,
            'tier': 'Priority 3 (LinkedIn Company Guest)',
            'type': 'linkedin_guest',
            'domain': live_domain or f"{slug}.com",
            'career_url': f"https://www.linkedin.com/jobs/search/?keywords={urllib.parse.quote(name)}",
            'jobs': li_cnt,
            'sample_job': li_titles[0] if li_titles else '',
            'notes': notes
        }

    # Step 4: Category 4 - Active Tracking / 0 Current Vacancies (NOT EXCLUDED)
    return {
        'num': company['num'],
        'company': name,
        'tier': 'Category 4 (Active tracking / 0 vacancies)',
        'type': 'active_tracking',
        'domain': live_domain or (f"{slug}.com" if slug else 'unknown'),
        'career_url': f"https://{live_domain}" if live_domain else '',
        'jobs': 0,
        'status': 'temporarily_empty',
        'notes': notes
    }

def main():
    print("Loading Veselova Excel file...")
    wb = openpyxl.load_workbook('/tmp/veselova.xlsx')
    ws = wb.active
    veselova_raw = []
    for r in range(3, ws.max_row + 1):
        val = ws.cell(row=r, column=2).value
        num = ws.cell(row=r, column=1).value
        notes = ws.cell(row=r, column=12).value
        geo = ws.cell(row=r, column=6).value
        if val and str(val).strip():
            veselova_raw.append({
                'num': int(num) if num else len(veselova_raw) + 1,
                'name': str(val).strip(),
                'notes': str(notes).strip() if notes else '',
                'geo': str(geo or '').strip()
            })

    with open('/tmp/idagent_companies.json') as f:
        id_list = json.load(f)

    to_resolve = []
    for v in veselova_raw:
        v_name = v['name']
        matched_id = None
        for it in id_list:
            id_c = it.get('company', '')
            pattern = r'(?i)^\s*(?:[A-Z]\s+)?\b' + re.escape(v_name) + r'\b'
            if re.search(pattern, id_c):
                matched_id = id_c
                break
        if not matched_id:
            to_resolve.append(v)

    print(f"Total unique companies to resolve with deep corporate audit: {len(to_resolve)}")

    start_t = time.time()
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=40) as executor:
        future_map = {executor.submit(resolve_company_deep, c): c for c in to_resolve}
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            completed += 1
            res = future.result()
            results.append(res)
            if completed % 25 == 0 or completed == len(to_resolve):
                print(f"Deep Audit Progress: {completed}/{len(to_resolve)} companies resolved ({time.time()-start_t:.1f}s)")

    results.sort(key=lambda x: x['num'])

    out_path = '/tmp/veselova_deep_resolution.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\nDeep audit complete in {time.time()-start_t:.1f}s! Saved to {out_path}")

    # Summary
    by_tier = {}
    for r in results:
        t = r.get('tier', 'Unknown')
        by_tier[t] = by_tier.get(t, 0) + 1

    print("\nDeep Audit Summary Breakdown:")
    for t, cnt in sorted(by_tier.items()):
        print(f"  {t}: {cnt}")

if __name__ == '__main__':
    main()
