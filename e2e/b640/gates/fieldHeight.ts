// Правка 102: в строке формы (общий родитель flex/grid) у input, select, поля даты и сегментов одинаковые height ±1 и top ±1.
// Строка — поля с пересекающимися по вертикали рамками внутри одного flex/grid-контейнера (перенос на вторую линию — другая строка).
// Ширины 1440, 1176, 390.
// Источник: _build/gates/verify_field_height.mjs макетов B640.
import type { Gate, GateResult } from './common';
import { NOTHING_TO_CHECK, SHOWN_JS } from './common';

interface RowFail {
  readonly host: string;
  readonly d: string;
}
interface Probe {
  readonly rows: number;
  readonly out: RowFail[];
}

const PROBE = `(() => { ${SHOWN_JS}
  const SEL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), select, .seg, .seg-ctl, .segmented, [role=radiogroup]';
  const all = [...document.querySelectorAll(SEL)].filter((e) => shown(e) && !e.closest('.rail, .bottom-nav, .topbar, .sw-cell') && !e.classList.contains('sw'));
  const fields = all.filter((e) => !all.some((o) => o !== e && o.contains(e)));
  const lay = (p) => /flex|grid/.test(getComputedStyle(p).display);
  const groups = new Map();
  for (const e of fields) {
    let p = e.parentElement, host = null;
    while (p && p !== document.body) { if (lay(p) && fields.filter((o) => p.contains(o)).length > 1) { host = p; break; } p = p.parentElement; }
    if (!host) continue;
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host).push(e);
  }
  const out = [];
  let rows = 0;
  for (const [host, list] of groups) {
    const rs = list.map((e) => ({ e, b: e.getBoundingClientRect() }));
    const used = new Set();
    for (const a of rs) {
      if (used.has(a)) continue;
      const row = rs.filter((o) => { const ov = Math.min(a.b.bottom, o.b.bottom) - Math.max(a.b.top, o.b.top); return ov > Math.min(a.b.height, o.b.height) * 0.5; });
      row.forEach((x) => used.add(x));
      if (row.length < 2) continue;
      rows++;
      const hs = row.map((x) => x.b.height), ts = row.map((x) => x.b.top);
      const dh = Math.max(...hs) - Math.min(...hs), dt = Math.max(...ts) - Math.min(...ts);
      if (dh > 1.01 || dt > 1.01) out.push({ host: (host.className || host.tagName).toString().split(' ')[0], d: row.map((x) => (x.e.name || x.e.id || x.e.className || x.e.tagName).toString().split(' ')[0] + ' h' + Math.round(x.b.height * 10) / 10 + ' y' + Math.round(x.b.top)).join(' | ') });
    }
  }
  return { rows, out }; })()`;

export const fieldHeightGate: Gate = {
  name: 'field_height',
  sizes: [
    [1440, 790],
    [1176, 790],
    [390, 844],
  ],
  async run(page): Promise<GateResult> {
    const r = (await page.evaluate(PROBE)) as Probe;
    if (!r.rows) return NOTHING_TO_CHECK;
    const failures = r.out.slice(0, 3).map((x) => `.${x.host}: ${x.d}`);
    if (r.out.length > 3) failures.push(`(+${r.out.length - 3})`);
    return { checked: r.rows, failures };
  },
};
