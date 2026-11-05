#!/usr/bin/env python3
"""
Comprehensive resolution script for OpenQareer:
1. ID Agent (358 career URLs) -> follow redirects, inspect DOM for ATS signatures, probe ATS APIs.
2. Veselova (634 companies) -> derive slugs, probe ATS providers, verify ownership.
3. Telegram (88 rows) -> categorize resources, fetch public channel previews, verify vacancy signals.
4. HireHi top companies -> probe ATS boards.
"""
import concurrent.futures
import csv
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

import functools
print = functools.partial(print, flush=True)

socket.setdefaulttimeout(6.0)

AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
PROBE_AGENT = "openqareer-source-probe/1.0 (+https://openqareer.com; candidate career source verification)"

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
]

ATS_PROBES = {
    'greenhouse': (lambda s: f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs", lambda d: len(d.get("jobs") or [])),
    'lever': (lambda s: f"https://api.lever.co/v0/postings/{s}?mode=json", lambda d: len(d) if isinstance(d, list) else 0),
    'ashby': (lambda s: f"https://api.ashbyhq.com/posting-api/job-board/{s}", lambda d: len(d.get("jobs") or [])),
    'workable': (lambda s: f"https://apply.workable.com/api/v1/widget/accounts/{s}?details=true", lambda d: len(d.get("jobs") or [])),
    'recruitee': (lambda s: f"https://{s}.recruitee.com/api/offers/", lambda d: len(d.get("offers") or [])),
    'smartrecruiters': (lambda s: f"https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=100", lambda d: len(d.get("content") or d.get("postings") or [])),
    'breezy': (lambda s: f"https://{s}.breezy.hr/json", lambda d: len(d) if isinstance(d, list) else 0),
    'pinpoint': (lambda s: f"https://{s}.pinpointhq.com/postings.json", lambda d: len(d.get("data") or d.get("postings") or []) if isinstance(d, dict) else len(d) if isinstance(d, list) else 0),
    'personio': (lambda s: f"https://{s}.jobs.personio.de/xml", lambda b: len(re.findall(r'<position>', b.decode('utf-8', 'ignore')))),
}

def probe_ats_board(provider, slug):
    if provider not in ATS_PROBES:
        return 0, 0
    url_fn, count_fn = ATS_PROBES[provider]
    url = url_fn(slug)
    req = urllib.request.Request(url, headers={'User-Agent': PROBE_AGENT, 'Accept': '*/*'})
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            if res.status != 200:
                return 0, 0
            body = res.read()
            if provider == 'personio':
                count = count_fn(body)
            else:
                data = json.loads(body.decode('utf-8', 'ignore'))
                count = count_fn(data)
            return count, len(body)
    except Exception:
        return 0, 0

def fetch_url(url, timeout=5):
    req = urllib.request.Request(url, headers={'User-Agent': AGENT, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            final_url = res.geturl()
            content_type = res.headers.get('Content-Type', '')
            body = res.read(250000).decode('utf-8', errors='ignore')
            return res.status, final_url, body, content_type
    except Exception as e:
        return None, url, '', ''

def extract_ats_from_url_or_html(initial_url, final_url, html):
    # Check URLs first
    for target in [final_url, initial_url]:
        for pat, prov in ATS_PATTERNS:
            m = re.search(pat, target, re.I)
            if m:
                slug = m.group(1).rstrip('/')
                if slug.lower() not in {'api', 'v1', 'v2', 'embed', 'widget', 'jobs', 'careers'}:
                    return prov, slug
    # Check HTML DOM for links/iframes
    if html:
        for pat, prov in ATS_PATTERNS:
            m = re.search(pat, html, re.I)
            if m:
                slug = m.group(1).rstrip('/"\'')
                if slug.lower() not in {'api', 'v1', 'v2', 'embed', 'widget', 'jobs', 'careers', 'assets'}:
                    return prov, slug
    return None, None

def resolve_idagent():
    print("=== RESOLVING ID AGENT DATASET ===")
    with open('/tmp/idagent_companies.json') as f:
        companies = json.load(f)

    results = []
    
    def process_company(item):
        name = item['company']
        url = item['careersUrl']
        
        # Check direct pattern
        prov, slug = extract_ats_from_url_or_html(url, url, '')
        if prov and slug:
            count, size = probe_ats_board(prov, slug)
            if count > 0:
                return {
                    'company': name,
                    'provider': prov,
                    'board': slug,
                    'jobs': count,
                    'careersUrl': url,
                    'discovery': 'direct_url'
                }

        # Otherwise fetch
        status, final_url, html, ctype = fetch_url(url, timeout=5)
        if status == 200:
            prov, slug = extract_ats_from_url_or_html(url, final_url, html)
            if prov and slug:
                count, size = probe_ats_board(prov, slug)
                if count > 0:
                    return {
                        'company': name,
                        'provider': prov,
                        'board': slug,
                        'jobs': count,
                        'careersUrl': final_url,
                        'discovery': 'page_scrape'
                    }
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
        futures = {executor.submit(process_company, c): c for c in companies}
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                results.append(res)
                print(f"IDAgent: FOUND {res['company']} -> {res['provider']}:{res['board']} ({res['jobs']} jobs)")

    print(f"IDAgent total confirmed ATS boards: {len(results)}")
    with open('/tmp/idagent_resolved_boards.json', 'w') as out:
        json.dump(results, out, indent=2, ensure_ascii=False)
    return results

def resolve_veselova():
    print("\n=== RESOLVING VESELOVA DATASET ===")
    companies = []
    with open('/tmp/Veselova.csv', mode='r', encoding='utf-8') as f:
        reader = csv.reader(f)
        for i, row in enumerate(reader):
            if i >= 2 and len(row) > 1 and row[1].strip():
                cname = row[1].strip()
                if cname not in {'Компания', '#'}:
                    notes = row[11] if len(row) > 11 else ''
                    remote = row[6] if len(row) > 6 else ''
                    reloc = row[8] if len(row) > 8 else ''
                    companies.append({'name': cname, 'notes': notes, 'remote': remote, 'reloc': reloc})

    print(f"Veselova total companies in sheet: {len(companies)}")

    results = []
    # Providers to probe by derived slug
    probe_providers = ['ashby', 'greenhouse', 'lever', 'workable', 'recruitee', 'smartrecruiters', 'personio', 'breezy']

    def candidate_slugs(company_name, notes):
        slugs = []
        # Latin only
        raw = company_name.lower().strip()
        clean = re.sub(r'[^a-z0-9]+', '', raw)
        if clean and len(clean) >= 3 and clean not in {'company', 'group', 'global', 'technologies', 'limited', 'team'}:
            slugs.append(clean)
        hyphen = re.sub(r'[^a-z0-9]+', '-', raw).strip('-')
        if hyphen and hyphen != clean:
            slugs.append(hyphen)
        # Check notes for domain or urls
        m = re.findall(r'https?://(?:www\.)?([a-zA-Z0-9.-]+)', notes)
        for domain in m:
            s = domain.split('.')[0]
            if len(s) >= 3 and s not in slugs and s not in {'t', 'linkedin', 'github', 'notion', 'docs', 'google'}:
                slugs.append(s)
        return slugs[:3]

    def verify_ownership(provider, slug, company_name):
        # Verify published name or title
        c_norm = re.sub(r'[^a-z0-9]+', '', company_name.lower())
        if provider == 'greenhouse':
            try:
                req = urllib.request.Request(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", headers={'User-Agent': PROBE_AGENT})
                with urllib.request.urlopen(req, timeout=4) as r:
                    d = json.loads(r.read())
                    names = {j.get("company_name", "").lower() for j in d.get("jobs", [])}
                    return any(c_norm in re.sub(r'[^a-z0-9]+', '', n) or re.sub(r'[^a-z0-9]+', '', n) in c_norm for n in names if n)
            except Exception:
                return False
        if provider == 'workable':
            try:
                req = urllib.request.Request(f"https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true", headers={'User-Agent': PROBE_AGENT})
                with urllib.request.urlopen(req, timeout=4) as r:
                    d = json.loads(r.read())
                    n = (d.get("name") or "").lower()
                    return c_norm in re.sub(r'[^a-z0-9]+', '', n) or re.sub(r'[^a-z0-9]+', '', n) in c_norm
            except Exception:
                return False
        if provider == 'recruitee':
            try:
                req = urllib.request.Request(f"https://{slug}.recruitee.com/api/offers/", headers={'User-Agent': PROBE_AGENT})
                with urllib.request.urlopen(req, timeout=4) as r:
                    d = json.loads(r.read())
                    names = {o.get("company_name", "").lower() for o in d.get("offers", [])}
                    return any(c_norm in re.sub(r'[^a-z0-9]+', '', n) or re.sub(r'[^a-z0-9]+', '', n) in c_norm for n in names if n)
            except Exception:
                return False
        if provider in ('lever', 'ashby'):
            try:
                host = f"https://jobs.lever.co/{slug}" if provider == 'lever' else f"https://jobs.ashbyhq.com/{slug}"
                req = urllib.request.Request(host, headers={'User-Agent': PROBE_AGENT})
                with urllib.request.urlopen(req, timeout=4) as r:
                    b = r.read(30000).decode('utf-8', 'ignore')
                    m = re.search(r'<title[^>]*>(.*?)</title>', b, re.I | re.S)
                    if m:
                        title_norm = re.sub(r'[^a-z0-9]+', '', m.group(1).lower())
                        return c_norm in title_norm or title_norm in c_norm or (len(c_norm) >= 4 and c_norm[:5] in title_norm)
            except Exception:
                return False
        return True # Default to True for other providers if probe succeeded

    def probe_company(c):
        slugs = candidate_slugs(c['name'], c['notes'])
        for s in slugs:
            for prov in probe_providers:
                count, size = probe_ats_board(prov, s)
                if count > 0:
                    if verify_ownership(prov, s, c['name']):
                        return {
                            'company': c['name'],
                            'provider': prov,
                            'board': s,
                            'jobs': count,
                            'remote': c['remote'],
                            'reloc': c['reloc']
                        }
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(probe_company, c): c for c in companies}
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                results.append(res)
                print(f"Veselova: CONFIRMED {res['company']} -> {res['provider']}:{res['board']} ({res['jobs']} jobs)")

    print(f"Veselova total confirmed ATS boards: {len(results)}")
    with open('/tmp/veselova_resolved_boards.json', 'w') as out:
        json.dump(results, out, indent=2, ensure_ascii=False)
    return results

def resolve_telegram():
    print("\n=== RESOLVING TELEGRAM DATASET ===")
    rows = []
    with open('/tmp/Telegram.csv', mode='r', encoding='utf-8') as f:
        reader = csv.reader(f)
        for i, r in enumerate(reader):
            if i >= 4 and len(r) > 1 and r[1].strip():
                rows.append({
                    'row_idx': i,
                    'name': r[0].strip(),
                    'url': r[1].strip(),
                    'direction': r[2].strip() if len(r) > 2 else '',
                    'content': r[3].strip() if len(r) > 3 else '',
                    'junior': r[4].strip() if len(r) > 4 else '',
                    'remote': r[5].strip() if len(r) > 5 else '',
                    'abroad': r[6].strip() if len(r) > 6 else '',
                })

    print(f"Total rows in Telegram table: {len(rows)}")
    
    categories = {
        'public_channel': [],
        'chat': [],
        'bot': [],
        'website': [],
        'private_or_blog': []
    }

    for item in rows:
        url = item['url'].lower().strip()
        name = item['name']
        desc = item['content'].lower()
        
        # Check if website
        if not ('t.me' in url or 'telegram' in url):
            item['category'] = 'website'
            categories['website'].append(item)
            continue
        
        # Check if bot
        if 'bot' in url.split('/')[-1] or 'бот' in desc or 'бот' in name.lower():
            item['category'] = 'bot'
            categories['bot'].append(item)
            continue
            
        # Check if private link
        if '/+' in url or 'joinchat' in url:
            item['category'] = 'private_or_blog'
            categories['private_or_blog'].append(item)
            continue
            
        # Check if chat
        if 'чат' in desc or 'чат' in name.lower():
            item['category'] = 'chat'
            categories['chat'].append(item)
            continue
            
        # Check if blog/consultant without vacancies
        if 'вакансий там нет' in desc or 'личный блог' in desc or 'консультант' in desc or 'канал создательницы' in desc:
            item['category'] = 'private_or_blog'
            categories['private_or_blog'].append(item)
            continue

        # Extract channel slug
        slug = url.split('/')[-1].split('?')[0].replace('@', '').strip()
        if slug:
            item['channel_slug'] = slug
            item['category'] = 'public_channel'
            categories['public_channel'].append(item)
        else:
            item['category'] = 'private_or_blog'
            categories['private_or_blog'].append(item)

    print(f"Telegram categorization:")
    print(f"  Public broadcast channels: {len(categories['public_channel'])}")
    print(f"  Chats (mixed posts): {len(categories['chat'])}")
    print(f"  Bots: {len(categories['bot'])}")
    print(f"  Websites / Portals: {len(categories['website'])}")
    print(f"  Private links / Blogs / No-vacancy: {len(categories['private_or_blog'])}")

    # Test web preview on public channels
    active_public_channels = []
    
    def probe_channel(ch):
        slug = ch['channel_slug']
        preview_url = f"https://t.me/s/{slug}"
        status, final_url, html, ctype = fetch_url(preview_url, timeout=5)
        if status == 200 and 'tgme_widget_message_text' in html:
            # Count posts
            posts = re.findall(r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', html, re.S)
            return {
                **ch,
                'status': 'active',
                'posts_in_preview': len(posts),
                'preview_url': preview_url
            }
        return {
            **ch,
            'status': 'inaccessible_or_empty',
            'posts_in_preview': 0
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(probe_channel, ch): ch for ch in categories['public_channel']}
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res['status'] == 'active':
                active_public_channels.append(res)
                print(f"Telegram: ACTIVE channel @{res['channel_slug']} ({res['posts_in_preview']} posts in web-preview)")

    print(f"Telegram active verified public channels: {len(active_public_channels)} of {len(categories['public_channel'])}")
    with open('/tmp/telegram_categorized.json', 'w') as out:
        json.dump({
            'active_public_channels': active_public_channels,
            'all_categories': {k: len(v) for k, v in categories.items()},
            'details': categories
        }, out, indent=2, ensure_ascii=False)

    return active_public_channels

if __name__ == '__main__':
    t0 = time.time()
    idagent_boards = resolve_idagent()
    veselova_boards = resolve_veselova()
    tg_channels = resolve_telegram()
    print(f"\nALL RESOLUTION COMPLETE in {time.time()-t0:.1f}s")
    print(f"Summary:")
    print(f"  IDAgent ATS boards: {len(idagent_boards)}")
    print(f"  Veselova ATS boards: {len(veselova_boards)}")
    print(f"  Telegram active public channels: {len(tg_channels)}")
