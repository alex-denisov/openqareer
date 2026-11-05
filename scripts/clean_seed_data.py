import json

with open('server/data/companyDirectorySeed.json') as f:
    data = json.load(f)

print(f"Original length: {len(data)}")

# 1. Remove duplicate index 1183 (empty key / jetbrains duplicate tail)
# Filter out any record with empty companyKey or companyName 'Самыеузнаваемые брендыв списке'
filtered = []
seen_keys = set()
for c in data:
    k = c.get('companyKey', '').strip()
    name = c.get('companyName', '').strip()
    if not k or 'самыеузнаваемые' in name.lower() or 'самые узнаваемые' in name.lower():
        print(f"Dropping garbage record: {name} (key: '{k}')")
        continue
    if k in seen_keys:
        print(f"Dropping duplicate key: '{k}' ({name})")
        continue
    seen_keys.add(k)
    filtered.append(c)

print(f"Length after dedup: {len(filtered)}")

# 2. Fix the shifted brand records
brand_fixes = {
    'jetbrains': {
        'companyName': 'JetBrains',
        'websiteUrl': 'https://www.jetbrains.com',
        'careersUrl': 'https://www.jetbrains.com/careers/',
        'linkedinUrl': 'https://www.linkedin.com/company/jetbrains/jobs/',
        'atsProvider': None,
        'atsSlug': None,
        'sourceType': 'corporate_portal',
        'geo': 'Global; Remote',
        'industry': 'Developer Tools & IDEs',
        'domainGroup': 'Software & IT'
    },
    'revolut': {
        'companyName': 'Revolut',
        'websiteUrl': 'https://www.revolut.com',
        'careersUrl': 'https://www.revolut.com/careers/',
        'linkedinUrl': 'https://www.linkedin.com/company/revolut/jobs/',
        'atsProvider': 'lever',
        'atsSlug': 'revolut',
        'sourceType': 'corporate_portal',
        'geo': 'UK; Europe; Remote',
        'industry': 'Neobanking & FinTech SuperApp',
        'domainGroup': 'Fintech'
    },
    'clickhouse': {
        'companyName': 'ClickHouse',
        'websiteUrl': 'https://clickhouse.com',
        'careersUrl': 'https://clickhouse.com/careers',
        'linkedinUrl': 'https://www.linkedin.com/company/clickhouse/jobs/',
        'atsProvider': 'ashby',
        'atsSlug': 'clickhouse',
        'sourceType': 'corporate_portal',
        'geo': 'USA; Europe; Remote WW',
        'industry': 'Open-Source Columnar Database DBMS',
        'domainGroup': 'Software & IT'
    },
    'telegram': {
        'companyName': 'Telegram',
        'websiteUrl': 'https://telegram.org',
        'careersUrl': 'https://telegram.org/jobs',
        'linkedinUrl': 'https://www.linkedin.com/company/telegram/jobs/',
        'atsProvider': None,
        'atsSlug': None,
        'sourceType': 'corporate_portal',
        'geo': 'UAE; Remote',
        'industry': 'Cloud-Based Messaging & Social Platform',
        'domainGroup': 'Software & IT'
    },
    'perplexity': {
        'companyName': 'Perplexity',
        'websiteUrl': 'https://www.perplexity.ai',
        'careersUrl': 'https://jobs.ashbyhq.com/perplexity.ai',
        'linkedinUrl': 'https://www.linkedin.com/company/perplexity-ai/jobs/',
        'atsProvider': 'ashby',
        'atsSlug': 'perplexity.ai',
        'sourceType': 'ats_direct',
        'geo': 'USA; Remote',
        'industry': 'AI Conversational Search Engine',
        'domainGroup': 'Software & IT'
    },
    'grammarly': {
        'companyName': 'Grammarly',
        'websiteUrl': 'https://www.grammarly.com',
        'careersUrl': 'https://www.grammarly.com/jobs',
        'linkedinUrl': 'https://www.linkedin.com/company/grammarly/jobs/',
        'atsProvider': 'greenhouse',
        'atsSlug': 'grammarly',
        'sourceType': 'corporate_portal',
        'geo': 'USA; Europe; Remote',
        'industry': 'AI Communication & Writing Assistant',
        'domainGroup': 'Software & IT'
    },
    'higgsfield-ai': {
        'companyName': 'Higgsfield AI',
        'websiteUrl': 'https://higgsfield.ai',
        'careersUrl': 'https://higgsfield.ai/careers',
        'linkedinUrl': 'https://www.linkedin.com/company/higgsfield-ai/jobs/',
        'atsProvider': None,
        'atsSlug': None,
        'sourceType': 'corporate_portal',
        'geo': 'USA; Remote',
        'industry': 'Generative AI & Video Creation Foundation Models',
        'domainGroup': 'Software & IT'
    }
}

for c in filtered:
    k = c.get('companyKey')
    if k in brand_fixes:
        c.update(brand_fixes[k])
        print(f"Applied verified fix for: {k} -> {c['websiteUrl']}")

with open('server/data/companyDirectorySeed.json', 'w', encoding='utf-8') as f:
    json.dump(filtered, f, indent=2, ensure_ascii=False)
    f.write('\n')

print(f"Cleaned seed file written with {len(filtered)} records.")
