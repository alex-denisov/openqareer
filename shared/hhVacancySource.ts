import { hhVacancyIdFromUrl } from './hhCandidateSession';

/** Источник вакансии: поля, по которым узнаётся площадка. */
export interface VacancySourceRef {
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly sourceUrl?: string;
}

/** Площадка, через которую идёт отклик. */
export interface ApplySource {
  readonly source: string | undefined;
  readonly url: string;
  readonly hh: boolean;
}

interface ApplyVacancy {
  readonly sources: readonly VacancySourceRef[];
  readonly primaryUrl: string;
}

export function isHhHost(hostname: string): boolean {
  return hostname === 'hh.ru' || hostname.endsWith('.hh.ru');
}

function isHhUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && isHhHost(url.hostname);
  } catch {
    return false;
  }
}

/** hh.ru на проде приходит как `json_api` с `sourceId: hh`: тип один из признаков, не единственный. */
export function isHhSource(source: VacancySourceRef): boolean {
  if (source.sourceType === 'hh' || source.sourceId === 'hh') return true;
  return isHhUrl(source.sourceUrl) || /^hh\.ru\b/iu.test(source.sourceName ?? '');
}

/**
 * Площадка отклика (B678): hh.ru, когда она среди источников, иначе первый источник. Адрес —
 * вакансии на этой же площадке: по нему отклик hh.ru берёт номер вакансии.
 */
export function preferredApplySource({ sources, primaryUrl }: ApplyVacancy): ApplySource {
  const hhSources = sources.filter(isHhSource);
  const withVacancy = hhSources.find((source) => hhVacancyIdFromUrl(source.sourceUrl));
  const hh = withVacancy ?? hhSources[0];
  if (!hh) return { source: sources[0]?.sourceName, url: primaryUrl, hh: false };
  const url = withVacancy || !isHhUrl(primaryUrl) ? (hh.sourceUrl ?? primaryUrl) : primaryUrl;
  return { source: hh.sourceName ?? 'hh.ru', url, hh: true };
}
