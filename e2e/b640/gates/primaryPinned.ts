// Тред 51553cee: на 390 единственная акцентная кнопка экрана (.is-primary вне навигации, строк списков и карточек) стоит
// в полосе, закреплённой у низа окна (position sticky или fixed, bottom не auto) — над нижней навигацией; внутри листа
// или диалога — в закреплённом подвале модалки. Экраны без главной кнопки не ошибка (checked: 0).
// Правка 55: вне модалки залитая .is-primary только в полосе с position: fixed (sticky — провал: на снимке во всю высоту он стоит
// посередине); два и больше видимых primary в одной области (страница или модалка) — провал.
// Источник: _build/gates/verify_primary_pinned.mjs макетов B640.
import type { Gate, GateResult } from './common';
import { NOTHING_TO_CHECK, ROOT_SELECTOR, SHOWN_JS } from './common';

interface Item {
  readonly t: string;
  readonly ok: boolean;
  readonly modal: boolean;
  readonly par: string;
  readonly dupe?: boolean;
}

const probeSource = (root: string): string => `((ROOT) => { ${SHOWN_JS}
  const rootEl = document.querySelector(ROOT);
  if (!rootEl || (!rootEl.dataset.template && !rootEl.dataset.dialog)) return null;
  // строки списков и карточки; а также встроенные в содержимое блоки со своим действием — баннер ошибки [role=alert],
  // полоса-предложение .gap-strip, строка ввода (.dn-q-row, .cw-add), состояние цели .gt-state, пустой список .vl-empty
  const ROWS = 'li, tr, article, .row, .card, .src, .cn-row, .pg, .lk-row, .vt-row, [role="alert"], .gap-strip, .dn-q-row, .cw-add, .gt-state, .vl-empty, .vl-empty-a';
  const fixedBar = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (s.position === 'fixed' && s.bottom !== 'auto') return true; } return false; };
  const stuck = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if ((s.position === 'sticky' || s.position === 'fixed') && s.bottom !== 'auto') return true; } return false; };
  const inModal = (e) => e.closest('[role="dialog"], [aria-modal="true"], ' + ROOT + '[data-dialog] .panel-col');
  const prims = [...document.querySelectorAll('.is-primary')]
    .filter((e) => !e.closest('nav, .rail, .bottomnav, .bottom-nav, .topbar') && shown(e) && !e.closest(ROWS));
  const allPrim = [...document.querySelectorAll('.is-primary')].filter((e) => !e.closest('nav, .rail, .bottomnav, .bottom-nav, .topbar') && shown(e));
  const scopeOf = (e) => inModal(e) || document.body;
  const dup = [...new Set(allPrim.map(scopeOf))].map((sc) => allPrim.filter((e) => scopeOf(e) === sc)).filter((g) => g.length > 1);
  const dups = dup.map((g) => ({ t: g.map((e) => '«' + e.innerText.trim().slice(0, 20) + '»').join(' + '), ok: false, modal: false, par: 'дубль primary', dupe: true }));
  return dups.concat(prims.map((e) => {
    const modal = inModal(e);
    // в модалке: кнопка в подвале, а модалка закреплена (fixed) — тогда подвал у низа окна
    const ok = (modal ? stuck(e) : fixedBar(e)) || (!!modal && getComputedStyle(modal).position === 'fixed' && e.getBoundingClientRect().bottom <= innerHeight);
    return { t: e.innerText.trim().slice(0, 30), ok, modal: !!modal, par: e.parentElement.className.split(" ")[0] || e.parentElement.tagName };
  }));
})(${JSON.stringify(root)})`;

export const primaryPinnedGate: Gate = {
  name: 'primary_pinned',
  sizes: [[390, 844]],
  async run(page): Promise<GateResult> {
    const r = (await page.evaluate(probeSource(ROOT_SELECTOR))) as Item[] | null;
    if (!r || !r.length) return NOTHING_TO_CHECK;
    const bad = r.filter((x) => !x.ok);
    if (!bad.length) return { checked: r.length, failures: [] };
    const text = bad
      .map((x) =>
        x.dupe
          ? `два и больше primary ${x.t}`
          : `не fixed «${x.t}» [${x.par}${x.modal ? ' modal' : ''}]`,
      )
      .join(', ');
    return { checked: r.length, failures: [text] };
  },
};
