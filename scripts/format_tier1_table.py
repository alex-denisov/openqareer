import json

with open('output/batch1_top90_resolved.json') as f:
    data = json.load(f)

lines = []
lines.append('| № | Компания | Официальный сайт | Карьерный раздел / Вакансии | LinkedIn Jobs (0 keywords) | Гео | Индустрия | Доменная группа |')
lines.append('|---|---|---|---|---|---|---|---|')

for i, c in enumerate(data, 1):
    name = c['companyName'].replace('|', '/')
    web_clean = c['websiteUrl'].replace('https://', '').replace('http://', '').rstrip('/')
    car_clean = c['careersUrl'].replace('https://', '').replace('http://', '').rstrip('/')
    web = f"[{web_clean}]({c['websiteUrl']})"
    car = f"[{car_clean}]({c['careersUrl']})"
    li = f"[LinkedIn Jobs]({c['linkedinUrl']})"
    geo = c['geo'].replace('|', '/')
    ind = c['industry'].replace('|', '/')
    dom = c['domainGroup'].replace('|', '/')
    lines.append(f'| {i} | **{name}** | {web} | {car} | {li} | {geo} | {ind} | {dom} |')

output = '\n'.join(lines)
with open('output/tier1_table.md', 'w') as f:
    f.write(output)
print(f'Successfully formatted {len(data)} rows.')
