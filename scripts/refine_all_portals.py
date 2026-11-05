#!/usr/bin/env python3
"""
Refine all career portals in OpenQareer for the Veselova dataset.

Focus:
Re-audit all companies currently in Priority 2 (ATS) or Priority 3 (LinkedIn)
by prioritizing primary global tech domains (.com, .io, .ai, .co, .cloud, .tech, .app, .net)
and aggressively extracting career links from the corporate homepage.
"""
import concurrent.futures
import functools
import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

print = functools.partial(print, flush=True)

socket.setdefaulttimeout(3.5)

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/128.0.0.0 Safari/537.36'
    ),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8'
}

def norm(s):
    if not s: return ''
    return re.sub(r'[^a-z0-9]', '', str(s).lower())

def fetch(url, timeout=3.0):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status, r.geturl(), r.read(150000).decode('utf-8', errors='ignore')
    except Exception:
        return None, url, ''

def dns_resolves(host):
    try:
        socket.gethostbyname(host)
        return True
    except:
        return False

def inspect_company_for_own_portal(company_item):
    name = company_item['company']
    notes = company_item.get('notes', '')
    slug = norm(name)
    words = [norm(w) for w in name.split() if len(w) > 1]
    
    # 1. Candidate domains prioritizing global tech extensions
    candidates = []
    
    # If notes have a domain, put it first
    if notes:
        m_dom = re.findall(r'\b([a-zA-Z0-9-]+\.(?:com|io|ai|co|cloud|tech|app|net|org|group))\b', notes)
        for d in m_dom:
            candidates.append(d.lower())
        m_alias = re.search(r'бывшая\s+([A-Za-z0-9]+)', notes)
        if m_alias:
            aslug = norm(m_alias.group(1))
            candidates.extend([f"{aslug}.com", f"{aslug}.ai", f"{aslug}.io"])

    # Hyphenated variation if multi-word
    if len(words) > 1:
        hyphen_slug = "-".join(words)
        candidates.extend([f"{hyphen_slug}.com", f"{hyphen_slug}.io"])

    # Standard global tech TLDs
    for tld in ['com', 'io', 'ai', 'co', 'cloud', 'tech', 'app', 'net', 'group', 'org']:
        candidates.append(f"{slug}.{tld}")

    seen = set()
    deduped = []
    for d in candidates:
        if d not in seen:
            seen.add(d)
            deduped.append(d)

    for dom in deduped:
        if not dns_resolves(dom):
            continue

        # Fetch homepage
        status, fin_home, html = fetch(f"https://{dom}")
        if status not in (200, 301, 302, 307, 308) or not html:
            continue

        # Look for career links in navigation/footer
        found_links = []
        for m in re.finditer(r'href=[\"\']([^\"\']+)[\"\']', html, re.I):
            h = m.group(1).strip()
            if any(k in h.lower() for k in ['career', 'job', 'vacanc', 'join-us', 'work-with-us', 'stellen', 'open-position', 'equipo']):
                if h.startswith('/'):
                    h = f"https://{dom}{h}"
                elif h.startswith('./'):
                    h = f"https://{dom}/{h[2:]}"
                elif not h.startswith('http'):
                    h = f"https://{dom}/{h}"
                found_links.append(h)

        # Common direct paths
        direct_paths = [
            f"https://{dom}/careers",
            f"https://{dom}/company/careers",
            f"https://{dom}/jobs",
            f"https://{dom}/about/careers",
            f"https://{dom}/company/jobs",
            f"https://{dom}/company#career",
            f"https://careers.{dom}",
            f"https://jobs.{dom}"
        ]

        probes = list(dict.fromkeys(found_links[:3] + direct_paths))
        for pu in probes:
            p_status, p_url, p_html = fetch(pu)
            if p_status in (200, 301, 302, 307, 308) and p_html:
                # Confirm it has career/job content
                if any(k in p_html.lower() for k in ['open position', 'job', 'career', 'vacanc', 'join our team', 'work with us', 'schema.org/jobposting', 'ashbyhq', 'greenhouse', 'lever.co', 'workable']):
                    # Check direct job links
                    job_links = set(re.findall(r'href=[\"\']([^\"\']*(?:/career-opening/|/job-details/|/vacancy/|/jobs?/|/careers?/)[^\"\']*)[\"\']', p_html, re.I))
                    job_links = [l for l in job_links if not l.endswith('/careers') and not l.endswith('/jobs')]
                    
                    sub_type = 'corporate_html'
                    if '__NEXT_DATA__' in p_html:
                        sub_type = 'next_data'

                    return {
                        'num': company_item['num'],
                        'company': name,
                        'tier': 'Priority 1 (Own site career portal)',
                        'type': sub_type,
                        'domain': dom,
                        'career_url': p_url,
                        'jobs': max(len(job_links), 1),
                        'sample_job': job_links[0] if job_links else p_url,
                        'notes': notes
                    }
        break # Checked best live domain

    return None

def main():
    with open('/tmp/veselova_deep_resolution.json') as f:
        data = json.load(f)

    p1 = [d for d in data if d.get('tier') == 'Priority 1 (Own site career portal)']
    p2_and_p3 = [d for d in data if d.get('tier') != 'Priority 1 (Own site career portal)']

    print(f"Current P1: {len(p1)}, Remaining to refine (P2 & P3): {len(p2_and_p3)}")

    start_t = time.time()
    promoted = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=35) as executor:
        future_map = {executor.submit(inspect_company_for_own_portal, c): c for c in p2_and_p3}
        for future in concurrent.futures.as_completed(future_map):
            orig_c = future_map[future]
            res = future.result()
            if res:
                promoted += 1
                # Replace in data
                idx = next(i for i, x in enumerate(data) if x['num'] == orig_c['num'])
                data[idx] = res

    print(f"\nRefinement completed in {time.time()-start_t:.1f}s!")
    print(f"Newly promoted to Priority 1 (Own site career portal): {promoted} companies!")

    # Save refined resolution
    with open('/tmp/veselova_deep_resolution.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    by_tier = {}
    for r in data:
        t = r.get('tier', 'Unknown')
        by_tier[t] = by_tier.get(t, 0) + 1

    print("\nUpdated Breakdown:")
    for t, cnt in sorted(by_tier.items()):
        print(f"  {t}: {cnt}")

if __name__ == '__main__':
    main()
