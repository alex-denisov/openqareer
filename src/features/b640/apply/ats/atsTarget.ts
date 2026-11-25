import type { ManualApplyReason } from '../../../../../shared/manualApply';
import type { ApplyChannel, ApplyTarget } from '../../../../../shared/applyTarget';

/** B787: площадки, форму которых приложение заполняет само. Точный адрес проверяет приложение. */
const HOSTS =
  /^(?:(?:job-)?boards(?:\.eu)?\.greenhouse\.io|jobs\.ashbyhq\.com|jobs(?:\.eu)?\.lever\.co|apply\.workable\.com|[a-z0-9-]+\.(?:recruitee|teamtailor|pinpointhq)\.com)$/u;

const parse = (value: string | null | undefined): URL | null => {
  const url = value && URL.canParse(value) ? new URL(value) : null;
  return url?.protocol === 'https:' && !url.username && !url.password ? url : null;
};

export interface AtsAddress {
  readonly url: string;
  readonly host: string;
}

function knownAddress(value: string | null | undefined): AtsAddress | null {
  const url = parse(value);
  // Доску знает сервер: её форма уже в `formUrl`. Параметрам адреса вакансии веры нет.
  return url && HOSTS.test(url.hostname) ? { url: url.href, host: url.hostname } : null;
}

/** Адрес формы узнанной площадки: страница формы цели отклика, затем адрес вакансии. */
export function atsAddressOf(
  target: ApplyTarget | null | undefined,
  url: string | null,
): AtsAddress | null {
  const formUrl = target && !target.needsRedirect ? target.formUrl : null;
  return knownAddress(formUrl) ?? knownAddress(url);
}

/** Площадки со своим путём отклика: очередь «отправить на сайте» им не нужна. */
const OWN_WAY: ReadonlySet<ApplyChannel> = new Set([
  'hh',
  'linkedin',
  'indeed',
  'telegram',
  'email',
  'board',
]);
const WITH_ACCOUNT: ReadonlySet<ApplyChannel> = new Set(['workday', 'icims']);

/** Почему отклик на сайте работодателя отправляет кандидат; `null` — это не сайт работодателя. */
export function ownSiteReason(target: ApplyTarget | null | undefined): ManualApplyReason | null {
  if (!target || target.needsRedirect || OWN_WAY.has(target.channel)) return null;
  return WITH_ACCOUNT.has(target.channel) ? 'account_required' : 'other';
}
