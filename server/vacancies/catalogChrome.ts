/**
 * Шапка и подвал публичного каталога (B535) — та же разметка, что у
 * `PublicHeader`/`PublicFooter` в src/features/site/PublicSiteChrome.tsx.
 * Каталог отдаётся сервером без бандла, поэтому разметка повторена здесь;
 * `catalogChrome.test.ts` держит наборы ссылок одинаковыми.
 */
import { LEGAL_DOCS, legalPath } from '../../shared/legalRegistry';
import { CATALOG_ROOT } from '../../shared/vacancyCatalogRoutes';

import {
  OPERATOR_TAX_ID,
  SUPPORT_EMAIL,
  TELEGRAM_BOT_URL,
  TELEGRAM_COMMUNITY_URL,
} from '../../src/features/site/publicSiteContent';

const BRAND =
  '<a class="ps-brand" href="/" aria-label="openqareer"><span class="brand-lockup">' +
  '<img src="/favicon.svg" width="26" height="26" alt="">' +
  '<span class="brand-lockup-word">open<span class="brand-lockup-qareer">qareer</span></span>' +
  '</span></a>';

export const CATALOG_NAV_LINKS: readonly { readonly label: string; readonly href: string }[] = [
  { label: 'Как это работает', href: '/#how' },
  { label: 'Кабинет', href: '/#apply' },
  { label: 'Вакансии', href: CATALOG_ROOT },
  { label: 'Тарифы', href: '/#tariffs' },
  { label: 'Вопросы', href: '/faq' },
];

export function catalogChromeHeader(): string {
  const nav = CATALOG_NAV_LINKS.map((link) =>
    link.href === CATALOG_ROOT
      ? `<a href="${link.href}" aria-current="page">${link.label}</a>`
      : `<a href="${link.href}">${link.label}</a>`,
  ).join('');
  return (
    '<header class="ps-top"><div class="ps-wrap ps-top-row">' +
    BRAND +
    `<nav class="ps-nav" aria-label="Разделы сайта">${nav}</nav>` +
    '<div class="ps-top-actions">' +
    '<a class="ps-btn is-login" href="/login">Войти</a>' +
    '<a class="ps-btn is-primary" href="/signup">Найти работу</a>' +
    '</div></div></header>'
  );
}

const docs = LEGAL_DOCS.map((doc) => `<a href="${legalPath(doc.slug)}">${doc.navLabel}</a>`).join(
  '',
);

export const CATALOG_CHROME_FOOTER =
  '<footer class="ps-footer"><div class="ps-wrap ps-footer-grid">' +
  `<div>${BRAND}<p class="ps-footer-about">Сервис для поиска работы специалистам и руководителям.</p></div>` +
  '<div class="ps-footer-group"><b>Продукт</b><a href="/#how">Как это работает</a>' +
  '<a href="/#tariffs">Тарифы</a><a href="/#download">Приложение для компьютера</a><a href="/login">Войти</a></div>' +
  `<div class="ps-footer-group"><b>Инструменты</b><a href="${CATALOG_ROOT}">Каталог вакансий</a>` +
  `<a href="${CATALOG_ROOT}/remote">Удалённые вакансии</a></div>` +
  '<div class="ps-footer-group"><b>Помощь</b><a href="/faq">Вопросы и ответы</a><a href="/support">Поддержка</a>' +
  `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>` +
  `<a href="${TELEGRAM_BOT_URL}" rel="noopener">Telegram-бот</a>` +
  `<a href="${TELEGRAM_COMMUNITY_URL}" rel="noopener">Сообщество в Telegram</a></div>` +
  `<div class="ps-footer-group"><b>Документы</b>${docs}</div>` +
  `<div class="ps-footer-legal"><span>© ${new Date().getFullYear()} openqareer</span><span>ИП, ИНН ${OPERATOR_TAX_ID}</span>` +
  '<button type="button" class="ps-footer-cookie" data-oq-consent-open="">Настройки cookie</button></div>' +
  '</div></footer>';
