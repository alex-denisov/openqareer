/**
 * B569: one source of truth for the public site's header, footer and plan
 * strip, from the approved mockup (`build.py`: NAV, header(), FOOTER, PLANBAR).
 * React (`PublicSiteChrome.tsx`) and the server-rendered pages (catalog,
 * salaries, interview questions) both render from these lists, and
 * `publicSiteChrome.test.ts` holds the two renderings to the same links.
 */
import { LEGAL_DOCS, legalPath } from './legalRegistry';

export type PublicSection = 'vacancies' | 'tools' | 'tariffs' | 'faq';

export interface ChromeLink {
  readonly label: string;
  readonly href: string;
  readonly external?: boolean;
}

export interface ChromeColumn {
  readonly title: string;
  readonly links: readonly ChromeLink[];
}

export const PUBLIC_NAV: readonly (ChromeLink & { readonly id: PublicSection })[] = [
  { id: 'vacancies', label: 'Вакансии', href: '/vacancies' },
  { id: 'tools', label: 'Инструменты', href: '/#tools' },
  { id: 'tariffs', label: 'Тарифы', href: '/tariffs' },
  { id: 'faq', label: 'Вопросы', href: '/faq' },
];

export const MENU_LABEL = 'Меню разделов';
export const MENU_ID = 'ps-menu';
export const BRAND_LABEL = 'openqareer — на главную';

/**
 * B574: «Инструменты» opens this list; without JS the item stays a link to
 * /#tools. The list is drawn on opening (React) or by `oq-chrome-2.js`, which
 * repeats it — `publicSiteChrome.test.ts` keeps the two equal.
 */
export const PUBLIC_TOOLS: readonly ChromeLink[] = [
  { label: 'Каталог вакансий', href: '/vacancies' },
  { label: 'Калькулятор зарплаты на руки', href: '/tools/salary-calculator' },
  { label: 'Зарплаты по профессиям', href: '/salaries' },
  { label: 'Конструктор резюме', href: '/tools/resume' },
  { label: 'Вопросы на собеседовании', href: '/tools/interview-questions' },
  { label: 'В какую страну переехать', href: '/tools/relocation' },
];
/** Desktop dropdown and the phone menu group each get their own list id. */
export const TOOLS_MENU_IDS = { nav: 'ps-tools-menu', menu: 'ps-menu-tools' } as const;

export const FOOTER_ABOUT =
  'Поиск работы с ИИ: резюме, вакансии со всего рынка и отклики в одном месте.';

/** Footer columns of mockup `FOOTER`; every link answers 200 (B574 returned relocation). */
export const PUBLIC_FOOTER_COLUMNS: readonly ChromeColumn[] = [
  {
    title: 'Поиск',
    links: [
      { label: 'Все вакансии', href: '/vacancies' },
      { label: 'Удалённая работа', href: '/vacancies/remote' },
      { label: 'Вакансии с релокацией', href: '/vacancies/relocation' },
      { label: 'Тарифы', href: '/tariffs' },
    ],
  },
  {
    title: 'Инструменты',
    links: [
      { label: 'Конструктор резюме', href: '/tools/resume' },
      { label: 'Вопросы на собеседовании', href: '/tools/interview-questions' },
      { label: 'Калькулятор зарплаты на руки', href: '/tools/salary-calculator' },
      { label: 'Зарплаты по профессиям', href: '/salaries' },
      { label: 'В какую страну переехать', href: '/tools/relocation' },
    ],
  },
  {
    title: 'Помощь',
    links: [
      { label: 'Вопросы и ответы', href: '/faq' },
      { label: 'Поддержка', href: '/support' },
      { label: 'Telegram-бот', href: 'https://t.me/openqareer_bot', external: true },
      { label: 'Приложение для Mac', href: '/downloads/openqareer-macos.dmg' },
    ],
  },
  {
    title: 'Документы',
    links: LEGAL_DOCS.map((doc) => ({ label: doc.navLabel, href: legalPath(doc.slug) })),
  },
];

export const PLAN_BAR = {
  strong: 'Free навсегда',
  rest: ' · резюме, должности и вакансии со всего рынка',
  label: 'Тарифы и что в них входит →',
  href: '/tariffs',
} as const;

export const OPERATOR_LINE = 'ИП, ИНН 774315089677';
export const SUPPORT_CONTACT = 'support@openqareer.com';

/** The nav section a public path belongs to, for `aria-current`. */
export function sectionForPath(path: string): PublicSection | undefined {
  const clean = path.split(/[?#]/u)[0] ?? '';
  if (/^\/(tools|salaries)(\/|$)/u.test(clean)) return 'tools';
  return PUBLIC_NAV.find(
    (item) => item.href !== '/#tools' && (clean === item.href || clean.startsWith(`${item.href}/`)),
  )?.id;
}

/** The «Free навсегда» strip sits above the footer on tool, salary and vacancy pages. */
export function showsPlanBar(path: string): boolean {
  return /^\/(tools|salaries|vacancies)(\/|$)/u.test(path.split(/[?#]/u)[0] ?? '');
}

// Phosphor «List» (regular), the same glyph the React header draws.
const MENU_ICON =
  '<svg width="22" height="22" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">' +
  '<path d="M224 128a8 8 0 0 1-8 8H40a8 8 0 0 1 0-16h176a8 8 0 0 1 8 8ZM40 72h176a8 8 0 0 0 0-16H40a8 8 0 0 0 0 16Zm176 112H40a8 8 0 0 0 0 16h176a8 8 0 0 0 0-16Z"/></svg>';

function attrs(link: ChromeLink, current: boolean): string {
  return `href="${link.href}"${link.external ? ' rel="noopener"' : ''}${current ? ' aria-current="page"' : ''}`;
}

/** The list itself is built by oq-chrome-2.js; without it the item stays a link. */
function toolsDisclosureHtml(current: boolean): string {
  return (
    '<div class="ps-tools is-nav"><a class="ps-tools-trigger" href="/#tools" aria-expanded="false" ' +
    `data-ps-disclosure${current ? ' aria-current="true"' : ''}>Инструменты</a></div>`
  );
}

function navLinksHtml(current?: PublicSection): string {
  return PUBLIC_NAV.map((item) =>
    item.id === 'tools'
      ? toolsDisclosureHtml(current === 'tools')
      : `<a ${attrs(item, item.id === current)}>${item.label}</a>`,
  ).join('');
}

/**
 * Both pairs of header actions are printed; `oq-auth-1.js` marks a signed-in
 * visitor on `<html>` before the first paint and CSS shows one pair (B574).
 */
const HEADER_ACTIONS_HTML =
  '<a class="ps-btn is-login ps-guest" href="/login">Войти</a>' +
  '<a class="ps-btn is-cta ps-guest" href="/signup">Найти работу</a>' +
  '<a class="ps-btn is-cta ps-member" href="/app">Открыть кабинет</a>';

/** Server-side header; `brand` is the page's own logo anchor. */
export function renderChromeHeaderHtml(brand: string, current?: PublicSection): string {
  return (
    '<header class="ps-top"><div class="ps-wrap ps-top-row">' +
    brand +
    `<nav class="ps-nav" aria-label="Разделы">${navLinksHtml(current)}</nav>` +
    `<div class="ps-top-actions">${HEADER_ACTIONS_HTML}` +
    `<button class="ps-menu-btn" type="button" aria-label="${MENU_LABEL}" aria-expanded="false" aria-controls="${MENU_ID}" data-ps-menu>${MENU_ICON}</button></div></div>` +
    // The phone menu opens only with oq-chrome-2.js, which copies the nav into
    // it: the links are printed once (vacancy pages keep to a 20 KB budget).
    `<nav class="ps-menu" id="${MENU_ID}" aria-label="Разделы" hidden>` +
    '<a class="ps-menu-login ps-guest" href="/login">Войти</a></nav></header>'
  );
}

export function renderPlanBarHtml(): string {
  return (
    '<aside class="ps-plan" aria-label="Тарифы"><div class="ps-wrap">' +
    `<span><b>${PLAN_BAR.strong}</b>${PLAN_BAR.rest}</span>` +
    `<a class="ps-plan-link" href="${PLAN_BAR.href}">${PLAN_BAR.label}</a></div></aside>`
  );
}

export function renderChromeFooterHtml(brand: string, year: number): string {
  const columns = PUBLIC_FOOTER_COLUMNS.map(
    (column) =>
      `<div class="ps-footer-group"><b>${column.title}</b>` +
      column.links.map((link) => `<a ${attrs(link, false)}>${link.label}</a>`).join('') +
      '</div>',
  ).join('');
  return (
    '<footer class="ps-footer"><div class="ps-wrap ps-footer-grid">' +
    `<div>${brand}<p class="ps-footer-about">${FOOTER_ABOUT}</p></div>${columns}` +
    `<div class="ps-footer-legal"><span>© ${year} openqareer</span><span>${OPERATOR_LINE}</span>` +
    `<span>${SUPPORT_CONTACT}</span>` +
    '<button type="button" class="ps-footer-cookie" data-oq-consent-open="">Настройки cookie</button></div>' +
    '</div></footer>'
  );
}
