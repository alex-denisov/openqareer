// Правки 107, 70, 81: на десктопе нижние элементы у низа окна. Окна 1440 и 1176 × высота 790 и 900.
// (а) нижняя группа рейла (.rail-end, .upd-wrap) целиком внутри окна;
// (б) закреплённая полоса формы (fixed/sticky с bottom ≠ auto, не рейл, не окно, не тост) и (в) панель ввода (form.compose):
//     bottom = низ окна ±1 при документе выше окна.
// Источник: _build/gates/verify_desktop_bottom.mjs макетов B640.
import type { Gate, GateResult } from './common';
import { NOTHING_TO_CHECK, SHOWN_JS } from './common';

interface Probe {
  readonly out: string[];
  readonly n: number;
}

const PROBE = `(() => { ${SHOWN_JS}
  const out = []; let n = 0;
  for (const e of document.querySelectorAll('.rail-end, .upd-wrap')) { if (!shown(e)) continue; n++; const b = e.getBoundingClientRect(); if (b.bottom > innerHeight + 1 || b.top < 0) out.push('рейл .' + e.className.split(' ')[0] + ' ' + Math.round(b.top) + '…' + Math.round(b.bottom) + ' вне окна ' + innerHeight); }
  const tall = document.documentElement.scrollHeight > innerHeight + 1;
  const strips = [...document.querySelectorAll('.b640 *')].filter((e) => { if (!shown(e) || e.closest('.rail, .topbar, .bottomnav, .bottom-nav, dialog, [role=dialog], [aria-modal=true], [role=tooltip], .toast')) return false; const s = getComputedStyle(e); return (s.position === 'fixed' || s.position === 'sticky') && s.bottom !== 'auto' && e.getBoundingClientRect().width > 120 && !e.matches('.rail, [role=tooltip]'); });
  const top = strips.filter((e) => !strips.some((o) => o !== e && o.contains(e)));
  if (tall) for (const e of top) { n++; const b = e.getBoundingClientRect(); if (Math.abs(b.bottom - innerHeight) > 1.01) out.push('полоса .' + (e.className || e.tagName).toString().split(' ')[0] + ' низ ' + Math.round(b.bottom) + ' ≠ ' + innerHeight + ' (bottom: ' + getComputedStyle(e).bottom + ')'); }
  for (const e of document.querySelectorAll('form.compose, .composer, [data-composer], .msg-compose')) { if (!shown(e) || !e.querySelector('textarea')) continue; n++; const b = e.getBoundingClientRect(); if (Math.abs(b.bottom - innerHeight) > 1.01) out.push('панель ввода низ ' + Math.round(b.bottom) + ' ≠ ' + innerHeight); }
  return { out, n }; })()`;

export const desktopBottomGate: Gate = {
  name: 'desktop_bottom',
  sizes: [
    [1440, 790],
    [1440, 900],
    [1176, 790],
    [1176, 900],
  ],
  async run(page): Promise<GateResult> {
    const r = (await page.evaluate(PROBE)) as Probe;
    if (!r.n) return NOTHING_TO_CHECK;
    return { checked: r.n, failures: r.out.slice(0, 3) };
  },
};
