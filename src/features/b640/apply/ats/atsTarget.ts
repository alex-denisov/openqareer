import type { ApplyTarget } from '../../../../../shared/applyTarget';

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
  readonly board?: string;
}

function knownAddress(value: string | null | undefined): AtsAddress | null {
  const url = parse(value);
  if (!url || !(HOSTS.test(url.hostname) || url.searchParams.has('gh_jid'))) return null;
  const board = url.searchParams.get('board') ?? '';
  return {
    url: url.href,
    host: url.hostname,
    ...(/^[\w-]{1,100}$/u.test(board) ? { board } : {}),
  };
}

/** Адрес формы узнанной площадки: страница формы цели отклика, затем адрес вакансии. */
export function atsAddressOf(
  target: ApplyTarget | null | undefined,
  url: string | null,
): AtsAddress | null {
  const formUrl = target && !target.needsRedirect ? target.formUrl : null;
  return knownAddress(formUrl) ?? knownAddress(url);
}
