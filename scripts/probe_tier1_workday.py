import urllib.request
import json
import socket

socket.setdefaulttimeout(4.0)

workday_candidates = [
    ('Airbus', 'airbus', 'wd3', 'Airbus'),
    ('ABB', 'abb', 'wd3', 'ABBExternal'),
    ('Medtronic', 'medtronic', 'wd1', 'MedtronicCareers'),
    ('Roche', 'roche', 'wd3', 'roche-careers'),
    ('Hitachi', 'hitachi', 'wd1', 'Hitachi_Careers'),
    ('DXC Technology', 'dxc', 'wd1', 'DXC_Careers'),
    ('RELX', 'relx', 'wd3', 'RELX'),
    ('GE Vernova', 'gevernova', 'wd5', 'GE_Vernova'),
    ('PepsiCo', 'pepsico', 'wd1', 'PEPSICO'),
    ('Thermo Fisher Scientific', 'thermofisher', 'wd1', 'ThermoFisher_Jobs'),
    ('AccorHotels', 'accor', 'wd3', 'Accor_Careers'),
    ('Nordic Semiconductor', 'nordicsemi', 'wd3', 'Nordic_Semiconductor'),
    ('Lloyds Banking Group', 'lloydsbankinggroup', 'wd1', 'Lloyds_Banking_Group'),
]

PROBE_AGENT = "openqareer-source-probe/1.0 (+https://openqareer.com; candidate career source verification)"

for comp, tenant, wd, site in workday_candidates:
    host = f"{tenant}.{wd}.myworkdayjobs.com"
    url = f"https://{host}/wday/cxs/{tenant}/{site}/jobs"
    req = urllib.request.Request(
        url,
        data=json.dumps({"appliedFacets": {}, "limit": 5, "offset": 0, "searchText": ""}).encode('utf-8'),
        headers={
            'User-Agent': PROBE_AGENT,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode('utf-8', 'ignore'))
                total = data.get('total', 0)
                jobs = data.get('jobPostings', [])
                sample = jobs[0].get('title') if jobs else 'none'
                print(f"CONFIRMED WORKDAY {comp}: total={total}, sample='{sample}', host='{host}', site='{site}'")
    except Exception as e:
        # print(f"FAIL {comp}: {e}")
        pass
