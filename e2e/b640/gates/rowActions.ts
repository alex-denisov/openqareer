// B640 итерация 4, п. 47: действия в строках и карточках списков (гейт по вычисленным стилям, не по классам).
// (а) в строке не больше одного элемента с видимой рамкой или заливкой (.is-quiet считается рамкой);
// (б) на экране не больше одной видимой залитой .btn.is-primary на ширину; в строке — только в .is-next;
// (в) .row-act и ссылки в строках без подчёркивания, цель не меньше 44×44 либо 24×24 без соседей (WCAG 2.5.8);
// (г) .only-desk на действиях внутри строки запрещён;
// (д) правка 86: у кнопок одной группы верх одинаковый ±2 px на 1440, 1176 и 390, закреплённая полоса исключена.
// Исключений по экранам нет. Высота окна 900 на всех ширинах, как в исходнике.
// Источник: _build/gates/verify_row_actions.mjs макетов B640.
import type { Gate, GateResult } from './common';

interface Probe {
  readonly a: string[];
  readonly b: string[];
  readonly c: string[];
  readonly d: string[];
  readonly e: string[];
  rows: number;
  prims: number;
}

// Исполняется в странице: без ссылок на внешние переменные модуля.
const probe = (): Probe => {
  const ROW =
    'li, tr, .notif, .resp-card, .au-cards li, .ir-fact, .dn-goal, .lk-card, .au-q-row, .rec-mark, .acc-card, dd.rec, .cv-row, .ha-item, .src, .step';
  const CTL = 'a, button, [role=button], .btn, input[type=button], input[type=submit]';
  const shown = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (
        e.tagName === 'DETAILS' &&
        !(e as HTMLDetailsElement).open &&
        el !== e &&
        !el.closest('summary')
      )
        return false;
      if (e.hasAttribute('popover') && !e.matches(':popover-open')) return false;
      if (e.getAttribute('aria-hidden') === 'true' && e.classList.contains('vt-pop')) return false;
    }
    return true;
  };
  const alpha = (c: string): number => {
    // rgb(), rgba(), oklch() и color(): альфа после «/» или четвёртое значение rgba
    if (!c || c === 'transparent') return 0;
    const sl = c.match(/\/\s*([\d.]+)(%?)\s*\)/);
    if (sl) return parseFloat(sl[1]) / (sl[2] ? 100 : 1);
    const m = c.match(/^rgba\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[ ,]+/).filter(Boolean);
      return p.length > 3 ? parseFloat(p[3]) : 1;
    }
    return 1;
  };
  const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
  const filled = (cs: CSSStyleDeclaration): boolean =>
    alpha(cs.backgroundColor) > 0.02 || cs.backgroundImage !== 'none';
  const bordered = (el: Element, cs: CSSStyleDeclaration): boolean =>
    el.classList.contains('is-quiet') ||
    SIDES.some(
      (s) =>
        parseFloat(cs[`border${s}Width`]) > 0 &&
        cs[`border${s}Style`] !== 'none' &&
        alpha(cs[`border${s}Color`]) > 0.02,
    );
  const vis = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    return filled(cs) || bordered(el, cs);
  };
  const out: Probe = { a: [], b: [], c: [], d: [], e: [], rows: 0, prims: 0 };
  const rows = [...document.querySelectorAll(ROW)].filter(
    (r) =>
      shown(r) && !r.closest('nav, .rail, .bottomnav, .topbar, .sec-tabs, [role=tablist], .crumbs'),
  );
  // самые внутренние строки: если внутри есть другая строка, смотрим её; внешний контейнер пропускаем, когда его контролы лежат во вложенной строке
  const owner = (el: Element): Element | null => {
    for (let e = el.parentElement; e; e = e.parentElement)
      if (e.matches(ROW) && rows.includes(e)) return e;
    return null;
  };
  const label = (el: Element): string => {
    const cn = (el as HTMLElement).className;
    return (
      (typeof cn === 'string' ? cn : '').split(' ').slice(0, 3).join('.') +
      ':' +
      (el.textContent || el.getAttribute('aria-label') || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 24)
    );
  };
  const byRow = new Map<Element, Element[]>();
  for (const c of document.querySelectorAll(CTL)) {
    if (!shown(c)) continue;
    if (
      c.closest(
        'nav, .rail, .bottomnav, .topbar, .sec-tabs, [role=tablist], .crumbs, summary, .acc-win',
      )
    )
      continue;
    if (c.matches('.chip, [role=radio], [role=tab]')) continue; // выбор из набора, а не действие строки
    let r = owner(c);
    if (!r) continue;
    // строка таблицы сравнения: у каждой ячейки своя кнопка, считаем по ячейке
    if (r.matches('tr:not(.vt-detail-row):not(.vt-form-row)')) {
      const cell = c.closest('td, th');
      if (cell) r = cell;
    }
    const list = byRow.get(r);
    if (list) list.push(c);
    else byRow.set(r, [c]);
  }
  out.rows = byRow.size;
  for (const [r, ctls] of byRow) {
    const rowName = label(r);
    const rowIsNext = !!r.closest('.is-next');
    // (а) раскрытая панель строки таблицы может нести два
    const lim = r.matches('tr.vt-detail-row, tr.vt-form-row') ? 2 : 1;
    const boxed = ctls.filter((c) => vis(c));
    if (boxed.length > lim)
      out.a.push(`${rowName} → ${boxed.length}: ${boxed.map(label).join(' | ')}`);
    // (б) primary внутри строки
    for (const c of ctls)
      if (c.matches('.btn.is-primary') && !rowIsNext)
        out.b.push(`primary в строке ${rowName}: ${label(c)}`);
    // (в)
    for (const c of ctls) {
      const cs = getComputedStyle(c);
      if (c.matches('.row-act, a:not(.btn)') && cs.textDecorationLine.includes('underline'))
        out.c.push(`подчёркивание: ${label(c)}`);
      if (c.matches('.row-act, a:not(.btn)')) {
        if (cs.display === 'inline') continue; // встроенная ссылка: исключение WCAG 2.5.8
        const b = c.getBoundingClientRect();
        if (b.width >= 44 && b.height >= 44) continue;
        if (b.width < 24 || b.height < 24) {
          out.c.push(`цель ${Math.round(b.width)}×${Math.round(b.height)}: ${label(c)}`);
          continue;
        }
        const cx = (b.left + b.right) / 2;
        const cy = (b.top + b.bottom) / 2;
        const sq = { l: cx - 12, r: cx + 12, t: cy - 12, b: cy + 12 };
        const near = ctls.some((o) => {
          if (o === c || c.contains(o) || o.contains(c)) return false;
          const q = o.getBoundingClientRect();
          return !(q.right < sq.l || q.left > sq.r || q.bottom < sq.t || q.top > sq.b);
        });
        if (near)
          out.c.push(
            `цель ${Math.round(b.width)}×${Math.round(b.height)} рядом с соседом: ${label(c)}`,
          );
      }
    }
    // (г)
    for (const c of ctls) {
      let inDesk = false;
      for (let e: Element | null = c; e && e !== r; e = e.parentElement) {
        if (e.matches('.only-desk, .only-desk-t')) inDesk = true;
      }
      if (inDesk) out.d.push(`only-desk на действии: ${rowName} / ${label(c)}`);
    }
  }
  // (д) правка 86: у кнопок одной группы (общий родитель) верх одинаковый ±2 px; закреплённая полоса исключена
  const pinnedStrip = (el: Element): boolean => {
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if ((s.position === 'fixed' || s.position === 'sticky') && s.bottom !== 'auto') return true;
    }
    return false;
  };
  const GROUP = '.actions, .msg-acts, [class*="-acts"], .ha-go, .row-acts';
  const byParent = new Map<Element, Element[]>();
  for (const c of document.querySelectorAll(CTL)) {
    if (
      !shown(c) ||
      c.closest(
        'nav, .rail, .bottomnav, .bottom-nav, .topbar, .sec-tabs, [role=tablist], .crumbs, summary',
      ) ||
      c.matches('.chip, [role=radio], [role=tab]') ||
      c.closest('.sec-seg, .seg-ctl')
    )
      continue;
    const p = c.parentElement;
    if (!p || !(p.matches(GROUP) || p.closest(ROW)) || pinnedStrip(c)) continue;
    const list = byParent.get(p);
    if (list) list.push(c);
    else byParent.set(p, [c]);
  }
  for (const [p, cs] of byParent) {
    if (cs.length < 2) continue;
    const tops = cs.map((c) => c.getBoundingClientRect().top);
    const d = Math.max(...tops) - Math.min(...tops);
    if (d > 2)
      out.e.push(
        `${label(p)}: верх кнопок разный на ${Math.round(d)} px (${cs.map(label).join(' | ')})`,
      );
  }
  // (б) на экране; при открытом модальном окне страница за ним инертна — считаем только окно.
  const modal = [
    ...document.querySelectorAll('dialog[open]:modal, [role="dialog"][aria-modal="true"]'),
  ].find(shown);
  const prim = [...(modal ?? document).querySelectorAll('.btn.is-primary')].filter(
    (e) => shown(e) && !e.closest('dialog:not([open])'),
  );
  if (prim.length > 1)
    out.b.push(`на экране ${prim.length} primary: ${prim.map(label).join(' | ')}`);
  return { ...out, prims: prim.length };
};

export const rowActionsGate: Gate = {
  name: 'row_actions',
  sizes: [
    [1440, 900],
    [1176, 900],
    [390, 900],
  ],
  async run(page): Promise<GateResult> {
    const r = await page.evaluate(probe);
    const failures = (['a', 'b', 'c', 'd', 'e'] as const).flatMap((k) =>
      r[k].map((m) => `(${k}): ${m}`),
    );
    return { checked: r.rows + r.prims, failures };
  },
};
