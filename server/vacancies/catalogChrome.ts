/**
 * Шапка, полоса тарифов и подвал публичного каталога (B535, B569). Каталог
 * отдаётся сервером без бандла; списки ссылок общие с React-страницами и лежат
 * в shared/publicSiteChrome.ts, `publicSiteChrome.test.ts` держит их равными.
 */
import {
  renderChromeFooterHtml,
  renderChromeHeaderHtml,
  renderPlanBarHtml,
} from '../../shared/publicSiteChrome';

const BRAND =
  '<a class="ps-brand" href="/" aria-label="openqareer"><span class="brand-lockup">' +
  '<img src="/favicon.svg" width="26" height="26" alt="">' +
  '<span class="brand-lockup-word">open<span class="brand-lockup-qareer">qareer</span></span>' +
  '</span></a>';

export function catalogChromeHeader(): string {
  return renderChromeHeaderHtml(BRAND, 'vacancies');
}

export function catalogChromeFooter(): string {
  return renderPlanBarHtml() + renderChromeFooterHtml(BRAND, new Date().getFullYear());
}
