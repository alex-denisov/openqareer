// Правки 44, 45, 85: отступы.
// (а) зазор по вертикали между соседними видимыми блоками основного столбца (#career-main, .col, section/.mod/.pf-f внутри форм)
//     ≤32 px на 1440 и 1176, ≤24 на 390; исключены fixed-полосы (sticky в потоке — сосед, фаза 2), нижняя навигация,
//     блоки рядом по горизонтали и скрытые;
// (б) подпись → поле: label[for] → #id, верх поля минус низ подписи ≤8 px на всех ширинах (подпись слева от поля и .vh не считаются);
// (в) строка-результат (значок Check + «Применено/Сохранено/Скопировано/Отклонено…» на месте, не тост) выше 40 px — провал.
// Источник: _build/gates/verify_spacing.mjs макетов B640.
import type { Gate, GateResult } from './common';
import { NOTHING_TO_CHECK, SHOWN_JS } from './common';

interface Probe {
  readonly out: string[];
  readonly pairs: number;
}

const probeSource = (width: number): string => `((W) => { ${SHOWN_JS}
  const maxGap = W <= 430 ? 24 : 32;
  const out = [];
  const nm = (e) => ((e.id ? '#' + e.id : '') || ('.' + (e.className || e.tagName).toString().split(' ')[0])) + ':' + (e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 18);
  const pinnedEl = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  const skip = (e) => e.matches('nav, .rail, .bottomnav, .bottom-nav, .topbar, script, style, .toast, [role=tooltip], .tip-bubble, dialog') || e.closest('.rail, .bottomnav, .bottom-nav, .topbar');
  const parents = new Set(['#career-main', '.col'].flatMap((s) => [...document.querySelectorAll(s)]));
  document.querySelectorAll('form').forEach((fm) => parents.add(fm));
  let pairs = 0;
  for (const p of parents) {
    if (!shown(p)) continue;
    // фаза 2: sticky-блок в потоке (панель фильтров списка) — сосед, иначе зазор меряется через него; fixed и предки fixed — вне
    const fixedUp = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return true; return false; };
    const kids = [...p.children].filter((e) => shown(e) && !skip(e) && !fixedUp(e) && ['static', 'relative', 'sticky'].includes(getComputedStyle(e).position));
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      const sameCol = Math.min(a.right, b.right) - Math.max(a.left, b.left) > Math.min(a.width, b.width) * 0.5;
      if (!sameCol || b.top < a.bottom - 1) continue;
      pairs++;
      const gap = Math.round(b.top - a.bottom);
      if (gap > maxGap) out.push('зазор ' + gap + ' > ' + maxGap + ': ' + nm(kids[i - 1]) + ' → ' + nm(kids[i]));
    }
  }
  for (const l of document.querySelectorAll('label[for]')) {
    if (!shown(l) || l.classList.contains('vh') || !l.innerText.trim()) continue;
    const t = document.getElementById(l.getAttribute('for'));
    if (!t || !shown(t) || t.closest('label') === l) continue;
    const a = l.getBoundingClientRect(), b = t.getBoundingClientRect();
    if (b.top < a.bottom - 1 || b.left >= a.right - 1) continue; // поле справа/в одной строке
    pairs++;
    const gap = Math.round(b.top - a.bottom);
    if (gap > 8) out.push('подпись → поле ' + gap + ' > 8: «' + l.innerText.trim().slice(0, 20) + '»');
  }
  // фаза 2: «Готово» на кнопке или ссылке — действие, а не строка-результат (первый текст внутри button/a)
  const firstTextInAction = (e) => { const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() ? 1 : 3 }); const n = tw.nextNode(); return !!(n && n.parentElement.closest('button, a, [role=button]')); };
  const RES = /^(Применено|Сохранено|Скопировано|Отклонено|Отправлено|Отменено|Принято|Добавлено|Подтверждено|Готово)(\\s|$|·)/;
  const hits = [...document.querySelectorAll('.b640 *')].filter((e) => shown(e) && !e.matches('script, style') && RES.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 60 && e.querySelector('[data-i="check"], svg') && !e.closest('.toast, [role=status].toast, [role=tooltip], .tip-bubble, [role=note], .tip, .v4-pop') && !pinnedEl(e) && !firstTextInAction(e));
  const top = hits.filter((e) => !hits.some((o) => o !== e && o.contains(e)));
  for (const e of top) { const h = Math.round(e.getBoundingClientRect().height); pairs++; if (h > 40) out.push('строка-результат ' + h + ' px > 40: «' + e.textContent.trim().slice(0, 24) + '»'); }
  return { out, pairs }; })(${width})`;

export const spacingGate: Gate = {
  name: 'spacing',
  sizes: [
    [1440, 790],
    [1176, 790],
    [390, 844],
  ],
  async run(page, width): Promise<GateResult> {
    const r = (await page.evaluate(probeSource(width))) as Probe;
    if (!r.pairs) return NOTHING_TO_CHECK;
    const failures = r.out.slice(0, 3);
    if (r.out.length > 3) failures.push(`(+${r.out.length - 3})`);
    return { checked: r.pairs, failures };
  },
};
