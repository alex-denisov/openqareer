// Read-only: period-split salary per city x role listing. Raw SQL, readOnly handle.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
const db = new DatabaseSync('/var/lib/openqareer/openqareer.db', { readOnly: true });
const keys = readFileSync('/tmp/oqsal/keys.txt', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('|'));
const q = db.prepare(
  `SELECT json_extract(c.cluster_json,'$.salary') AS s FROM catalog_entries e LEFT JOIN vacancy_clusters c ON c.id=e.cluster_id WHERE e.status='active' AND e.place_slug=? AND e.role_slug=?`,
);
const OK = {
  'lever.salaryRange.interval': {
    'per-hour-wage': 'hour',
    'per-month-salary': 'month',
    'per-year-salary': 'year',
  },
  'himalayas.salaryPeriod': { hourly: 'hour', monthly: 'month', annual: 'year' },
  'hh.compensation.mode': { MONTH: 'month' },
};
const quant = (a, p) => {
  const x = (a.length - 1) * p,
    l = Math.floor(x),
    u = Math.ceil(x);
  return Math.round(a[l] + (a[u] - a[l]) * (x - l));
};
const out = [];
for (const [place, role] of keys) {
  const groups = {};
  let unproven = 0;
  for (const { s } of q.all(place, role)) {
    if (!s) continue;
    let v;
    try {
      v = JSON.parse(s);
    } catch {
      continue;
    }
    const ev = v.periodEvidence;
    const p = ev && OK[ev.field]?.[ev.value];
    if (!p || p !== v.period) {
      if (v.from || v.to) unproven++;
      continue;
    }
    if (typeof v.currency !== 'string' || !/^[A-Z]{3}$/.test(v.currency)) continue;
    if (typeof v.from !== 'number' || typeof v.to !== 'number' || v.from <= 0 || v.to < v.from)
      continue;
    (groups[`${v.currency}|${p}`] ??= []).push([v.from, v.to]);
  }
  const salary = Object.entries(groups)
    .filter(([, r]) => r.length >= 5)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, r]) => {
      const [currency, period] = k.split('|');
      const lo = r.map((x) => x[0]).sort((a, b) => a - b);
      const hi = r.map((x) => x[1]).sort((a, b) => a - b);
      return {
        currency,
        period,
        sample: r.length,
        medianLow: quant(lo, 0.5),
        medianHigh: quant(hi, 0.5),
      };
    });
  out.push({ place, role, salary, unproven });
}
writeFileSync('/tmp/oqsal/salary.jsonl', out.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(
  out.length,
  out.filter((o) => o.salary.length).length,
  out.filter((o) => o.salary.length > 1).length,
);
