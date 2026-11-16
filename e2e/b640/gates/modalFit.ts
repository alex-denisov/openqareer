// Треды 3741b418 и 95e74dc1: открытое окно (любой видимый [role=dialog] / [aria-modal=true] / лист консультанта)
// помещается в окно браузера при scrollY=0: верх ≥ 0, низ окна и его главной кнопки ≤ высоты окна. Главная кнопка —
// .is-primary, иначе последняя кнопка подвала. Пустота под содержимым ≤ VOID (56), от низа последней кнопки до низа окна
// или листа не меньше FOOT_PAD (16) - 1. Размеры: 1440×790 и 1176×790 («первый экран ноутбука»), 390×844.
// Источник: _build/gates/verify_modal_fit.mjs макетов B640.
import type { Gate, GateResult } from './common';
import { ROOT_SELECTOR, SHOWN_JS } from './common';

const VOID = 56; // 16 отступ + 34 безопасная зона iPhone + запас
const FOOT_PAD = 16;

interface ModalProbe {
  readonly visBottom: number;
  readonly content: number;
  readonly lastB: number | null;
  readonly cls: string;
  readonly top: number;
  readonly bottom: number;
  readonly prim: string;
  readonly pb: number | null;
  readonly vh: number;
}

const probeSource = (root: string): string => `((ROOT) => { ${SHOWN_JS}
  const fixed = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return true; return false; };
  // окно, закрывающее страницу: закреплённое (fixed); всплывашки у строки (va-pop в потоке) меряются гейтом первого экрана
  const ms = [...document.querySelectorAll(ROOT + '[data-dialog] .panel-col, [role="dialog"], [aria-modal="true"]')].filter((e) => shown(e) && fixed(e));
  const top = ms.filter((e) => !ms.some((o) => o !== e && o.contains(e)));
  return top.map((m) => {
    const foot = [...m.querySelectorAll('[class*="foot"], .actions, footer, form.compose')].filter(shown).pop();
    const last = foot && [...foot.querySelectorAll('button, a.btn, a.row-act')].filter((e) => shown(e) && !/^Показать ещё/.test(e.innerText.trim())).pop();
    const prim = [...m.querySelectorAll('.is-primary')].find(shown) || last || null;
    const b = m.getBoundingClientRect();
    // правки 17, 99: низ содержимого и низ последней кнопки подвала
    const inner = [...m.querySelectorAll('*')].filter((e) => shown(e) && !e.matches('script, style'));
    const content = inner.length ? Math.max(...inner.map((e) => e.getBoundingClientRect().bottom)) : b.top;
    const btns = [...m.querySelectorAll('button, a.btn, a.row-act, input[type=submit]')].filter((e) => shown(e) && !/^Показать ещё/.test(e.innerText.trim()));
    const lastB = (last || btns.pop() || null);
    // лист над нижней навигацией (панель ввода по правке 81): видимый низ листа — верх навигации, если навигация поверх листа
    const nav = document.querySelector('.bottomnav, .bottom-nav');
    let visBottom = b.bottom;
    if (nav && shown(nav)) { const nr = nav.getBoundingClientRect(); if (m.matches('.panel-col') && nr.top < b.bottom) visBottom = nr.top; } // панель консультанта на 390 стоит над навигацией (правка 81)
    return { visBottom: Math.round(visBottom), content: Math.round(content), lastB: lastB ? Math.round(lastB.getBoundingClientRect().bottom) : null, cls: (m.className || m.tagName).toString().split(' ')[0], top: Math.round(b.top), bottom: Math.round(b.bottom), prim: prim ? prim.innerText.trim().slice(0, 24) : '', pb: prim ? Math.round(prim.getBoundingClientRect().bottom) : null, vh: innerHeight };
  });
})(${JSON.stringify(root)})`;

export const modalFitGate: Gate = {
  name: 'modal_fit',
  sizes: [
    [1440, 790],
    [1176, 790],
    [390, 844],
  ],
  async run(page): Promise<GateResult> {
    const modals = (await page.evaluate(probeSource(ROOT_SELECTOR))) as ModalProbe[];
    const failures: string[] = [];
    for (const m of modals) {
      const bad: string[] = [];
      if (m.top < 0) bad.push(`верх ${m.top}`);
      if (m.bottom > m.vh + 1) bad.push(`низ окна ${m.bottom} из ${m.vh}`);
      if (m.pb !== null && m.pb > m.vh + 1) bad.push(`кнопка «${m.prim}» ${m.pb}`);
      // правка 17: пустота под содержимым — от низа содержимого до низа окна не больше VOID px
      const gapBelow = Math.min(m.visBottom, m.vh) - m.content;
      if (gapBelow > VOID) bad.push(`пустота под содержимым ${gapBelow} px (> ${VOID})`);
      // правка 99: от низа последней кнопки до низа окна или листа не меньше 16 px
      if (m.lastB !== null) {
        const gap = Math.min(m.visBottom, m.vh) - m.lastB;
        if (gap < FOOT_PAD - 1) bad.push(`от кнопки до низа ${gap} px (< ${FOOT_PAD})`);
      }
      if (bad.length) failures.push(`.${m.cls}: ${bad.join('; ')}`);
    }
    return { checked: modals.length, failures };
  },
};
