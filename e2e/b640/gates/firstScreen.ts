// B640 round5, п. 18: первый экран телефона. На 390 заголовок экрана и единственная акцентная кнопка — выше y=700
// (iPhone 17 Pro 402×874, Safari с панелью инструментов; оценка, проверить window.innerHeight на устройстве).
// Экран без акцентной кнопки проверяется по заголовку. Открытый лист или диалог закрывает страницу: главная кнопка ищется
// только в нём, а закреплённый лист меряется от верха окна.
// Блок «рейл на десктопе» (правка 70) исходника здесь не переносится: он совпадает с пунктом (а) гейта desktop_bottom
// (.rail-end, .upd-wrap целиком внутри окна на 1440/1176 × 790/900), поэтому остаётся только телефон.
// Источник: _build/gates/verify_first_screen.mjs макетов B640.
import type { Gate, GateResult } from './common';
import { NOTHING_TO_CHECK, ROOT_SELECTOR, SHOWN_JS } from './common';

const FOLD = 700;

interface Probe {
  readonly sticky: boolean;
  readonly sheet: boolean;
  readonly modals: number;
  readonly form: boolean;
  readonly pinned: boolean;
  readonly vh: number;
  readonly height: number;
  readonly titleY: number | null;
  readonly title: string;
  readonly primY: number | null;
  readonly prim: string;
}

const probeSource = (root: string): string => `((ROOT) => { ${SHOWN_JS}
  const root = document.querySelector(ROOT);
  if (!root || (!root.dataset.template && !root.dataset.dialog)) return null;
  // Открытый лист/диалог на 390 закрывает страницу (решение CPO по K2): главная кнопка ищется только внутри листа; нет её
  // в листе — проверяется только заголовок. Лист консультанта (.b640[data-dialog] .panel-col) меряется от верха документа
  // с порогом FOLD; лист, закреплённый у низа окна (position: fixed), — от верха окна: он идёт за видимой высотой окна.
  // Тред 3741b418: любой видимый [role=dialog] / [aria-modal=true] / лист консультанта — открытая модалка, независимо от
  // позиционирования. Берётся верхняя — последняя в DOM.
  const modals = [...document.querySelectorAll(ROOT + '[data-dialog] .panel-col, [role="dialog"], [aria-modal="true"]')].filter(shown);
  const sheet = modals.filter((e) => !modals.some((o) => o !== e && o.contains(e))).pop() || null;
  const pinned = !!sheet;
  const scope = sheet || (root.dataset.dialog ? document.querySelector('.panel-col') || document : document.querySelector('main') || document);
  // заголовок экрана — верхний видимый заголовок (на 390 колонки идут одна под другой, порядок DOM не равен порядку на экране)
  const H = 'h1, h2, h3, .panel-head .who b, .panel-head .who strong, .panel-head .who span';
  // всплывающее окно у строки (va-pop) без своего заголовка — заголовок экрана берётся со страницы
  let heads = [...scope.querySelectorAll(H)].filter(shown);
  if (!heads.length && sheet) heads = [...(document.querySelector('main') || document).querySelectorAll(H)].filter(shown);
  const title = heads.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  // Главное действие модалки: .is-primary, иначе последняя кнопка её подвала.
  const foot = sheet && [...sheet.querySelectorAll('[class*="foot"], .actions, footer, form.compose')].filter(shown).pop();
  const lastBtn = foot && [...foot.querySelectorAll('button, a.btn, a.row-act')].filter((e) => shown(e) && !/^Показать ещё/.test(e.innerText.trim())).pop();
  const prim = [...(sheet || document).querySelectorAll('.is-primary')].filter((e) => !e.closest('nav, .rail, .bottom-nav')).find(shown) || lastBtn || null;
  const form = !!sheet && [...sheet.querySelectorAll('input:not([type=hidden]), textarea, select')].some(shown);
  const y = (e) => (e ? Math.round(e.getBoundingClientRect().bottom + (pinned ? 0 : scrollY)) : null);
  // Проход R2 (решение CPO): липкая полоса формы. Главная кнопка в контейнере с position sticky или fixed и нижним отступом
  // (bottom не auto), целиком в окне 844 при scrollY=0, считается на первом экране; остальное меряется по порогу FOLD.
  const stuckBar = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if ((s.position === 'sticky' || s.position === 'fixed') && s.bottom !== 'auto') return n; } return null; };
  const bar = prim && scrollY === 0 ? stuckBar(prim) : null;
  const pb = prim && prim.getBoundingClientRect();
  const sticky = !!bar && pb.top >= 0 && pb.bottom <= innerHeight;
  return { sticky, sheet: !!sheet, modals: modals.length, form, pinned, vh: innerHeight, height: document.documentElement.scrollHeight, titleY: y(title), title: title ? title.innerText.trim().slice(0, 40) : '', primY: y(prim), prim: prim ? prim.innerText.trim().slice(0, 30) : '' };
})(${JSON.stringify(root)})`;

export const firstScreenGate: Gate = {
  name: 'first_screen',
  sizes: [[390, 844]],
  async run(page): Promise<GateResult> {
    const r = (await page.evaluate(probeSource(ROOT_SELECTOR))) as Probe | null;
    if (!r) return NOTHING_TO_CHECK;
    const bad: string[] = [];
    const limit = r.pinned ? r.vh : FOLD;
    if (r.titleY === null) bad.push('нет заголовка');
    else if (r.titleY > limit) bad.push(`заголовок «${r.title}» на ${r.titleY}`);
    if (r.primY !== null && !r.sticky && r.primY > limit) {
      bad.push(`главная кнопка «${r.prim}» на ${r.primY}`);
    }
    if (r.sheet && r.primY === null && r.form) bad.push('в модалке с формой нет главного действия');
    const failures = bad.length ? [`${bad.join('; ')} (высота ${r.height})`] : [];
    return { checked: 1, failures };
  },
};
