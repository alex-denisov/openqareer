import json
import urllib.request
import re
import socket
import concurrent.futures

socket.setdefaulttimeout(4.0)

with open('output/batch1_top90_resolved.json') as f:
    companies = json.load(f)

print(f"Loaded {len(companies)} Tier 1 companies.")

PROBE_AGENT = "openqareer-source-probe/1.0 (+https://openqareer.com; candidate career source verification)"

ATS_PROBES = {
    'greenhouse': lambda s: f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs",
    'lever': lambda s: f"https://api.lever.co/v0/postings/{s}?mode=json",
    'ashby': lambda s: f"https://api.ashbyhq.com/posting-api/job-board/{s}",
    'workable': lambda s: f"https://apply.workable.com/api/v1/widget/accounts/{s}?details=true",
    'smartrecruiters': lambda s: f"https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=100",
    'recruitee': lambda s: f"https://{s}.recruitee.com/api/offers/",
}

def probe_ats(prov, slug):
    url = ATS_PROBES[prov](slug)
    req = urllib.request.Request(url, headers={'User-Agent': PROBE_AGENT, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode('utf-8', 'ignore'))
                if prov == 'greenhouse':
                    return len(data.get('jobs', []))
                elif prov == 'lever':
                    return len(data) if isinstance(data, list) else 0
                elif prov == 'ashby':
                    return len(data.get('jobs', []))
                elif prov == 'workable':
                    return len(data.get('jobs', []))
                elif prov == 'smartrecruiters':
                    return len(data.get('content', []) or data.get('postings', []))
                elif prov == 'recruitee':
                    return len(data.get('offers', []))
    except Exception:
        pass
    return 0

def check_company(c):
    name = c['companyName']
    key = c['companyKey']
    car = c['careersUrl']
    
    clean_name = re.sub(r'[^a-zA-Z0-9]+', '', key.lower())
    hyphen_name = re.sub(r'[^a-zA-Z0-9]+', '-', key.lower()).strip('-')
    
    slug_candidates = [clean_name, hyphen_name]
    m_domain = re.search(r'https?://(?:www\.)?([a-zA-Z0-9.-]+)', car)
    if m_domain:
        d_sub = m_domain.group(1).split('.')[0]
        if d_sub not in slug_candidates:
            slug_candidates.append(d_sub)

    found_ats = None
    for prov in ATS_PROBES:
        for s in slug_candidates:
            if not s or len(s) < 3:
                continue
            count = probe_ats(prov, s)
            if count > 0:
                found_ats = {'provider': prov, 'slug': s, 'jobs': count}
                break
        if found_ats:
            break

    return {
        'companyKey': key,
        'companyName': name,
        'careersUrl': car,
        'ats': found_ats
    }

with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
    results = list(ex.map(check_company, companies))

ats_found = [r for r in results if r['ats']]
print(f"\nDiscovered {len(ats_found)} confirmed live ATS boards among Tier 1:")
for r in ats_found:
    print(f"  - {r['companyName']}: {r['ats']['provider']} -> '{r['ats']['slug']}' ({r['ats']['jobs']} active jobs)")

with open('output/tier1_ats_discovered.json', 'w') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
