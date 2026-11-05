#!/usr/bin/env python3
"""
Optimized Veselova (634 companies) career source resolution pipeline for OpenQareer.

Priority hierarchy:
1. Own career section on company website (careers.domain, domain/careers, Next.js SSR, HTML cards, or ATS redirect/embed).
2. Popular ATS boards (Ashby, Greenhouse, Lever, Workable, SmartRecruiters, Recruitee, Breezy, BambooHR, Pinpoint, Personio).
3. LinkedIn Company Guest (f_C=<organizationId> or search?keywords=<company>).
4. Dormant / Not hiring / Defunct (all remaining companies).
"""
import concurrent.futures
import functools
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from bs4 import BeautifulSoup
import openpyxl

print = functools.partial(print, flush=True)

socket.setdefaulttimeout(2.5)

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
PROBE_AGENT = "openqareer-probe/1.0 (+https://openqareer.com; candidate career source verification)"

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

def fetch_url(url, timeout=2.5):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            final_url = res.geturl()
            content_type = res.headers.get('Content-Type', '')
            body = res.read(150000).decode('utf-8', errors='ignore')
            return res.status, final_url, body, content_type
    except Exception:
        return None, url, '', ''

def dns_resolves(host):
    try:
        socket.gethostbyname(host)
        return True
    except:
        return False

def probe_ats_api(provider, slug):
    if provider not in ATS_API_PROBES:
        return 0
    url_fn = ATS_API_PROBES[provider]
    url, count_fn = url_fn(slug)
    req = urllib.request.Request(url, headers={'User-Agent': PROBE_AGENT, 'Accept': '*/*'})
    try:
        with urllib.request.urlopen(req, timeout=2.5) as res:
            if res.status != 200:
                return 0
            body = res.read()
            if provider == 'personio':
                return count_fn(body.decode('utf-8', 'ignore'))
            data = json.loads(body.decode('utf-8', 'ignore'))
            return count_fn(data)
    except Exception:
        return 0

def verify_ats_ownership(provider, slug, company_name):
    c_norm = norm(company_name)
    s_norm = norm(slug)
    if c_norm in s_norm or s_norm in c_norm:
        return True
    if provider == 'greenhouse':
        try:
            req = urllib.request.Request(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", headers={'User-Agent': PROBE_AGENT})
            with urllib.request.urlopen(req, timeout=2.0) as r:
                d = json.loads(r.read())
                names = {norm(j.get("company_name", "")) for j in d.get("jobs", [])}
                return any(c_norm in n or n in c_norm for n in names if n)
        except:
            return False
    if provider == 'workable':
        try:
            req = urllib.request.Request(f"https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true", headers={'User-Agent': PROBE_AGENT})
            with urllib.request.urlopen(req, timeout=2.0) as r:
                d = json.loads(r.read())
                n = norm(d.get("name") or "")
                return c_norm in n or n in c_norm
        except:
            return False
    return False

def extract_ats_from_url_or_html(url, html):
    for pat, prov in ATS_PATTERNS:
        m = re.search(pat, url)
        if m:
            return prov, m.group(1)
    for pat, prov in ATS_PATTERNS:
        m = re.search(pat, html)
        if m:
            return prov, m.group(1)
    return None, None

def probe_linkedin_guest(company_name):
    c_norm = norm(company_name)
    query = urllib.parse.quote(company_name)
    url = f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={query}&start=0"
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html'})
    try:
        with urllib.request.urlopen(req, timeout=3.0) as res:
            if res.status != 200:
                return 0, []
            html = res.read().decode('utf-8', errors='ignore')
            subtitles = re.findall(r'base-search-card__subtitle\">([^<]+)<', html)
            titles = re.findall(r'base-search-card__title\">([^<]+)<', html)
            matching_titles = []
            for t, s in zip(titles, subtitles):
                s_clean = norm(s)
                if c_norm in s_clean or s_clean in c_norm or (len(c_norm) >= 4 and c_norm[:4] in s_clean):
                    matching_titles.append(t.strip())
            return len(matching_titles), matching_titles
    except Exception:
        return 0, []

def generate_candidate_domains(company_name, notes):
    name_clean = re.sub(r'[^a-zA-Z0-9\s.-]', '', company_name).strip()
    slug = re.sub(r'[^a-zA-Z0-9]', '', company_name).lower()
    
    candidates = []
    if '.' in name_clean:
        candidates.append(name_clean.lower())
    if notes:
        m_dom = re.search(r'\b([a-zA-Z0-9-]+\.(?:com|ai|io|app|co|tech|cloud|org|net))\b', notes)
        if m_dom:
            candidates.append(m_dom.group(1).lower())
        m_alias = re.search(r'бывшая\s+([A-Za-z0-9]+)', notes)
        if m_alias:
            alias_slug = re.sub(r'[^a-zA-Z0-9]', '', m_alias.group(1)).lower()
            candidates.append(f"{alias_slug}.ai")
            candidates.append(f"{alias_slug}.com")
            
    # Standard TLDs
    for tld in ['com', 'ai', 'io', 'app', 'co', 'tech']:
        candidates.append(f"{slug}.{tld}")
        
    seen = set()
    deduped = []
    for d in candidates:
        if d not in seen:
            seen.add(d)
            deduped.append(d)
    return deduped

def resolve_single_company(company):
    name = company['name']
    notes = company['notes']
    c_norm = norm(name)
    slug = norm(name)
    
    # -------------------------------------------------------------
    # Priority 1: Check Own Career Section on Company Website
    # -------------------------------------------------------------
    candidate_domains = generate_candidate_domains(name, notes)
    live_domain = None
    
    for dom in candidate_domains:
        if dns_resolves(dom):
            live_domain = dom
            # Fast check: fetch homepage
            status, home_url, home_html, _ = fetch_url(f"https://{dom}", timeout=2.5)
            if status == 200 and home_html:
                # 1. Did homepage directly redirect to ATS?
                ats_prov, ats_slug = extract_ats_from_url_or_html(home_url, home_html)
                if ats_prov and ats_slug:
                    cnt = probe_ats_api(ats_prov, ats_slug)
                    if cnt > 0:
                        return {
                            'num': company['num'],
                            'company': name,
                            'tier': 'Priority 1 (Own site -> ATS redirect/embed)',
                            'type': 'ats_board',
                            'provider': ats_prov,
                            'slug': ats_slug,
                            'domain': dom,
                            'career_url': home_url,
                            'jobs': cnt,
                            'notes': notes
                        }
                        
                # 2. Look for career link on homepage
                career_links = []
                for m in re.finditer(r'href=[\"\']([^\"\']+)[\"\']', home_html, re.I):
                    href = m.group(1).strip()
                    if any(k in href.lower() for k in ['careers', 'jobs', 'vacanc', 'join-us', 'work-with-us', 'career']):
                        # Normalize href
                        if href.startswith('/'):
                            href = f"https://{dom}{href}"
                        elif not href.startswith('http'):
                            href = f"https://{dom}/{href}"
                        career_links.append(href)
                        
                # Probe career link or standard /careers path
                probe_urls = list(dict.fromkeys(career_links[:2] + [f"https://{dom}/careers", f"https://careers.{dom}"]))
                for cu in probe_urls:
                    c_status, c_f_url, c_html, _ = fetch_url(cu, timeout=2.5)
                    if c_status == 200 and c_html:
                        # Check ATS embed or redirect
                        c_prov, c_slug = extract_ats_from_url_or_html(c_f_url, c_html)
                        if c_prov and c_slug:
                            cnt = probe_ats_api(c_prov, c_slug)
                            if cnt > 0:
                                return {
                                    'num': company['num'],
                                    'company': name,
                                    'tier': 'Priority 1 (Own site -> ATS redirect/embed)',
                                    'type': 'ats_board',
                                    'provider': c_prov,
                                    'slug': c_slug,
                                    'domain': dom,
                                    'career_url': c_f_url,
                                    'jobs': cnt,
                                    'notes': notes
                                }
                        # Check Next.js SSR
                        if '__NEXT_DATA__' in c_html and ('job' in c_html.lower() or 'career' in c_html.lower()):
                            return {
                                'num': company['num'],
                                'company': name,
                                'tier': 'Priority 1 (Own site -> Next.js SSR)',
                                'type': 'next_data',
                                'domain': dom,
                                'career_url': c_f_url,
                                'jobs': 1,
                                'notes': notes
                            }
                        # Check Corporate HTML / Schema.org
                        job_links = re.findall(r'href=[\"\']([^\"\']*(?:/careers?/|/jobs?/|/vacanc)[^\"\']*)[\"\']', c_html, re.I)
                        job_links = [l for l in set(job_links) if l != cu and len(l) > 10 and not l.endswith('/careers') and not l.endswith('/jobs')]
                        if len(job_links) >= 1 or 'schema.org/JobPosting' in c_html:
                            return {
                                'num': company['num'],
                                'company': name,
                                'tier': 'Priority 1 (Own site -> Corporate HTML)',
                                'type': 'corporate_html',
                                'domain': dom,
                                'career_url': c_f_url,
                                'jobs': max(len(job_links), 1),
                                'sample_job': job_links[0] if job_links else c_f_url,
                                'notes': notes
                            }
            break # Probed live domain
            
    # -------------------------------------------------------------
    # Priority 2: Popular ATS Direct Probing
    # -------------------------------------------------------------
    for ats_slug in [slug, f"{slug}ai", f"{slug}tech"]:
        for prov in ['greenhouse', 'ashby', 'lever', 'workable', 'smartrecruiters', 'recruitee', 'bamboohr', 'personio']:
            cnt = probe_ats_api(prov, ats_slug)
            if cnt > 0 and verify_ats_ownership(prov, ats_slug, name):
                return {
                    'num': company['num'],
                    'company': name,
                    'tier': 'Priority 2 (Direct ATS board probe)',
                    'type': 'ats_board',
                    'provider': prov,
                    'slug': ats_slug,
                    'domain': live_domain or f"{slug}.com",
                    'career_url': f"https://{prov}.com/{ats_slug}",
                    'jobs': cnt,
                    'notes': notes
                }
                
    # -------------------------------------------------------------
    # Priority 3: LinkedIn Company Guest
    # -------------------------------------------------------------
    li_count, li_titles = probe_linkedin_guest(name)
    if li_count > 0:
        return {
            'num': company['num'],
            'company': name,
            'tier': 'Priority 3 (LinkedIn Company Guest)',
            'type': 'linkedin_guest',
            'domain': live_domain or f"{slug}.com",
            'career_url': f"https://www.linkedin.com/jobs/search/?keywords={urllib.parse.quote(name)}",
            'jobs': li_count,
            'sample_job': li_titles[0] if li_titles else '',
            'notes': notes
        }
        
    # -------------------------------------------------------------
    # Category 4: Dormant / Not Hiring
    # -------------------------------------------------------------
    reason = "No open vacancies found on site, ATS, or LinkedIn"
    if not live_domain:
        reason = "Domain does not resolve or parked"
    return {
        'num': company['num'],
        'company': name,
        'tier': 'Category 4 (Dormant / Not hiring)',
        'type': 'dormant',
        'domain': live_domain or 'none',
        'career_url': f"https://{live_domain}" if live_domain else '',
        'jobs': 0,
        'reason': reason,
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
        domain_group = ws.cell(row=r, column=3).value
        industry = ws.cell(row=r, column=4).value
        geo = ws.cell(row=r, column=6).value
        if val and str(val).strip():
            veselova_raw.append({
                'num': int(num) if num else len(veselova_raw) + 1,
                'name': str(val).strip(),
                'notes': str(notes).strip() if notes else '',
                'domain_group': str(domain_group or '').strip(),
                'industry': str(industry or '').strip(),
                'geo': str(geo or '').strip()
            })

    print(f"Total Veselova companies in file: {len(veselova_raw)}")

    with open('/tmp/idagent_companies.json') as f:
        id_list = json.load(f)

    overlap_companies = []
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
            url = it.get('careersUrl', '')
            m = re.search(r'https?://(?:www\.|careers\.|jobs\.)?([a-zA-Z0-9-]+)\.', url)
            if m and m.group(1).lower() == norm(v_name):
                matched_id = f"domain:{m.group(1)}"
                break
        if matched_id:
            overlap_companies.append((v, matched_id))
        else:
            to_resolve.append(v)

    print(f"Deduplicated (already covered in ID Agent): {len(overlap_companies)}")
    print(f"Unique companies to resolve: {len(to_resolve)}")

    results = []
    print("\nStarting concurrent resolution across Priority 1 -> Priority 2 -> Priority 3...")
    start_t = time.time()
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
        future_map = {executor.submit(resolve_single_company, c): c for c in to_resolve}
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            completed += 1
            res = future.result()
            results.append(res)
            if completed % 25 == 0 or completed == len(to_resolve):
                print(f"Progress: {completed}/{len(to_resolve)} companies resolved ({time.time()-start_t:.1f}s)")
                
    results.sort(key=lambda x: x['num'])
    
    with open('/tmp/veselova_full_resolution.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
        
    print(f"\nResolution complete in {time.time()-start_t:.1f}s! Saved to /tmp/veselova_full_resolution.json")

if __name__ == '__main__':
    main()
