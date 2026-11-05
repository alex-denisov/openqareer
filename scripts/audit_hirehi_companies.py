import urllib.request
import re
import json
import time

def fetch_url(url, retries=2):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    req = urllib.request.Request(url, headers=headers)
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                return response.read().decode('utf-8')
        except Exception as e:
            if i == retries - 1:
                return None
            time.sleep(1)
    return None

def main():
    list_url = 'https://hirehi.ru/companies'
    html = fetch_url(list_url)
    if not html:
        print('Failed to fetch hirehi.ru/companies')
        return

    pattern = r'<a[^>]+href=[\"\']/companies/([^/\"\']+)[\"\'][^>]*>([\s\S]*?)</a>'
    matches = re.findall(pattern, html)

    companies = []
    seen = set()
    for slug, content in matches:
        if slug == 'nda' or slug in seen:
            continue
        seen.add(slug)
        clean = ' '.join(re.sub(r'<[^>]+>', ' ', content).split())
        m = re.search(r'^(.*?)\s+(\d+)\s+ваканси[йия]', clean)
        name = m.group(1).strip() if m else clean
        count = int(m.group(2)) if m else 0
        companies.append({'slug': slug, 'name': name, 'count': count})

    print(f'Discovered {len(companies)} leading companies from hirehi.ru/companies')

    results = []
    for idx, c in enumerate(companies, 1):
        slug = c['slug']
        name = c['name']
        comp_url = f'https://hirehi.ru/companies/{slug}'
        comp_html = fetch_url(comp_url)

        website = None
        vacancies = []
        if comp_html:
            scripts = re.findall(r'<script[^>]*type=[\"\']application/ld\+json[\"\'][^>]*>([\s\S]*?)</script>', comp_html)
            for s in scripts:
                try:
                    data = json.loads(s.strip())
                    if data.get('@type') == 'Organization':
                        website = data.get('url')
                    elif data.get('@type') == 'ItemList':
                        vacancies = data.get('itemListElement', [])
                except Exception:
                    pass

        sample_vac_data = None
        if vacancies:
            v_url = vacancies[0].get('url')
            v_html = fetch_url(v_url) if v_url else None
            if v_html:
                v_scripts = re.findall(r'<script[^>]*type=[\"\']application/ld\+json[\"\'][^>]*>([\s\S]*?)</script>', v_html)
                for vs in v_scripts:
                    try:
                        vdata = json.loads(vs.strip())
                        if vdata.get('@type') == 'JobPosting':
                            sample_vac_data = {
                                'title': vdata.get('title'),
                                'url': v_url,
                                'datePosted': vdata.get('datePosted'),
                                'location': vdata.get('jobLocation', {}).get('address', {}).get('addressLocality') if isinstance(vdata.get('jobLocation'), dict) else 'Remote / Not specified',
                                'descriptionLength': len(vdata.get('description', '')),
                                'skills': vdata.get('skills', '')[:100],
                                'status': 'LIVE'
                            }
                            break
                    except Exception:
                        pass

        results.append({
            'index': idx,
            'slug': slug,
            'name': name,
            'hirehiVacanciesCount': c['count'],
            'websiteUrl': website,
            'sampleVacancy': sample_vac_data
        })
        print(f'[{idx}/{len(companies)}] {name} ({slug}): site={website}, vac={sample_vac_data["title"] if sample_vac_data else "None"} (desc={sample_vac_data["descriptionLength"] if sample_vac_data else 0} chars)')

    with open('output/hirehi_companies_audit.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    main()
