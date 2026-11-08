import type { UnifiedVacancy } from '../domain/unifiedVacancy';

/**
 * B622 — ворота качества корпоративного сайта. Вакансия с сайта компании
 * проходит, только если её ссылка ведёт на домен этой компании или на ATS,
 * а название похоже на должность. Источник, где большинство записей не
 * прошло, падает с причиной вместо тихой записи мусора ('[object Object]',
 * ссылки на jobs.dou.ua и builtin.com из #501).
 */
const ATS_LINK_HOSTS =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|recruitee\.com|smartrecruiters\.com|breezy\.hr|pinpointhq\.com|personio\.(de|com)|bamboohr\.com|myworkdayjobs\.com|comeet\.(co|com)|teamtailor\.com|jobvite\.com|icims\.com|successfactors\.(com|eu)|taleo\.net|eightfold\.ai|huntflow\.(ru|io))$/i;

const MAX_TITLE_LENGTH = 140;
const MIN_TITLE_LENGTH = 3;
/** Доля прошедших записей, ниже которой источник считается сломанным. */
export const MIN_PASS_SHARE = 0.5;

const NAVIGATION_TITLES =
  /^(apply|apply now|learn more|read more|careers?|jobs?|вакансии|вакансії|подробнее|откликнуться|все вакансии|home|about( us)?|contact( us)?|privacy policy|cookie.*|talent (pool|network)|send your cv)$/i;
/** «All vacancies», «Search jobs», «View Openings →», «Join our team», «0 Your Saved Jobs». */
const NAVIGATION_PHRASE =
  /^\W*(\d+\s+)?(all|search|view|see|show( more)?|browse|find|explore|open|join|your( saved)?|go beyond)\b.{0,30}\b(jobs?|vacanc\w*|positions?|roles?|openings?|opportunit\w*|team|frontiers)\W*$/i;
/** Ссылка на страницу списка, а не на вакансию. */
const LISTING_URL =
  /(\/(jobs|vacancies|vacancy\/catalog|careers?|positions|all-jobs|openings|saved-jobs)\/?$)|[?&](department|professions|category)=/i;
/** Агрегаторы и чужие доски: их домен никогда не домен компании (B622, #501). */
const AGGREGATOR_HOSTS =
  /(^|\.)(dou\.ua|builtin\.com|careers-page\.com|linkedin\.com|indeed\.com|glassdoor\.com|djinni\.co|hh\.ru|wellfound\.com)$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function root(host: string): string {
  return host.split('.').slice(-2).join('.');
}

export type CorporateRejectReason = 'bad_title' | 'foreign_link';

export function corporateRejectReason(
  vacancy: Pick<UnifiedVacancy, 'title' | 'url'>,
  companyHosts: readonly string[],
): CorporateRejectReason | null {
  const title = (vacancy.title ?? '').trim();
  if (
    title.length < MIN_TITLE_LENGTH ||
    title.length > MAX_TITLE_LENGTH ||
    /\[object \w+\]|undefined|null|\{|\}|<|>/i.test(title) ||
    NAVIGATION_TITLES.test(title) ||
    NAVIGATION_PHRASE.test(title) ||
    LISTING_URL.test(vacancy.url ?? '')
  ) {
    return 'bad_title';
  }
  const host = hostOf(vacancy.url ?? '');
  if (!host || AGGREGATOR_HOSTS.test(host)) return 'foreign_link';
  if (ATS_LINK_HOSTS.test(host)) return null;
  const roots = new Set(companyHosts.map((h) => root(h)).filter(Boolean));
  return roots.has(root(host)) ? null : 'foreign_link';
}

export interface CorporateQualityVerdict {
  readonly kept: readonly UnifiedVacancy[];
  readonly rejected: Readonly<Record<CorporateRejectReason, number>>;
  readonly passed: boolean;
}

export function gateCorporateVacancies(
  vacancies: readonly UnifiedVacancy[],
  sourceUrls: readonly string[],
): CorporateQualityVerdict {
  const companyHosts = sourceUrls
    .map(hostOf)
    .filter((host) => host && !AGGREGATOR_HOSTS.test(host));
  const rejected: Record<CorporateRejectReason, number> = { bad_title: 0, foreign_link: 0 };
  const kept: UnifiedVacancy[] = [];
  for (const vacancy of vacancies) {
    const reason = corporateRejectReason(vacancy, companyHosts);
    if (reason) rejected[reason] += 1;
    else kept.push(vacancy);
  }
  const passed = vacancies.length === 0 || kept.length / vacancies.length >= MIN_PASS_SHARE;
  return { kept, rejected, passed };
}

export function corporateQualityError(verdict: CorporateQualityVerdict): Error {
  const { bad_title: badTitle, foreign_link: foreignLink } = verdict.rejected;
  return new Error(
    `corporate_source_quality_failed: kept ${verdict.kept.length}, bad_title ${badTitle}, foreign_link ${foreignLink}`,
  );
}
