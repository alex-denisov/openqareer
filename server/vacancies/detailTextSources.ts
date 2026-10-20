import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { decodeFeedEntities, htmlToFeedText } from '../connectors/feedText';
import { record, text } from './jsonVacancyRecord';
import { WORKDAY_SOURCE_PREFIX } from './workdayBoardSources';

/**
 * Площадки, чей список не отдаёт текст вакансии, а карточка — отдаёт (B535).
 * Каждая запись знает адрес карточки и как вынуть из ответа текст; адрес
 * строится только из публичной ссылки на хосте самой площадки, иначе чужая
 * запись увела бы запрос куда угодно. Замеры 20.10 с прод-VM:
 *
 * - SmartRecruiters: `/v1/companies/<board>/postings/<id>` → `jobAd.sections`;
 *   robots `api.smartrecruiters.com` разрешает `/v1/companies/`.
 * - Eightfold Microsoft и Qualcomm: `/api/pcsx/position_details` →
 *   `data.jobDescription`; Netflix: `/api/apply/v2/jobs/<id>` →
 *   `job_description`. robots всех трёх разрешает `/api/pcsx` и `/api/apply`.
 * - Habr Career и YC: публичная страница вакансии, `JobPosting` в JSON-LD;
 *   robots разрешает `/vacancies/<id>` и `/companies/<slug>/jobs/<slug>`.
 *
 * - LinkedIn: гостевая карточка `/jobs-guest/jobs/api/jobPosting/<id>`, текст
 *   в `show-more-less-html__markup`. robots запрещает `/jobs-guest/`; чтение
 *   карточек разрешил владелец 20.10 со случайным темпом 10–20 с между запросами (B535, к
 *   решению B218 о поиске). Учётки пула не участвуют: это гостевой GET.
 *
 * - Apple: страница вакансии, данные роутера (см. `apple`).
 *
 * Нет здесь: Himalayas (страница
 * отвечает 403 боту, а текст уже несёт JSON-источник `src-himalayas-api`),
 * hh (текст дочитывается по запросу, B304).
 */
export type DetailFormat = 'json' | 'html';

export interface DetailTextSource {
  readonly format: DetailFormat;
  detailUrl(sourceId: string, vacancy: Pick<UnifiedVacancy, 'url'>): string | undefined;
  readText(payload: unknown): string;
  /** Не чаще одного запроса за столько мс; без поля — каждый такт воркера. */
  readonly intervalMs?: number;
  /** Случайная добавка к `intervalMs` (0…jitter), чтобы такт не был ровным. */
  readonly intervalJitterMs?: number;
  /** Пауза источника после 429: площадка просит остановиться. */
  readonly throttlePauseMs?: number;
}

const SMARTRECRUITERS_PREFIX = 'ats-smartrecruiters-';

function httpsUrl(raw: string, host: string): URL | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === host ? url : undefined;
  } catch {
    return undefined;
  }
}

function htmlText(html: string): string {
  return html.trim() ? htmlToFeedText(html).trim() : '';
}

const workday: DetailTextSource = {
  format: 'json',
  detailUrl: (sourceId, vacancy) => {
    const tenant = sourceId.slice(WORKDAY_SOURCE_PREFIX.length);
    let url: URL;
    try {
      url = new URL(vacancy.url);
    } catch {
      return undefined;
    }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.myworkdayjobs.com')) return undefined;
    const [site, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!tenant || !site || rest.length === 0) return undefined;
    return `${url.origin}/wday/cxs/${tenant}/${site}/${rest.join('/')}`;
  },
  readText: (payload) => htmlText(text(record(record(payload).jobPostingInfo).jobDescription)),
};

const smartRecruiters: DetailTextSource = {
  format: 'json',
  detailUrl: (sourceId, vacancy) => {
    const board = sourceId.slice(SMARTRECRUITERS_PREFIX.length);
    const url = httpsUrl(vacancy.url, 'jobs.smartrecruiters.com');
    const [pathBoard, id, ...rest] = url?.pathname.split('/').filter(Boolean) ?? [];
    if (!board || pathBoard !== board || !id || rest.length > 0 || !/^\d+$/.test(id))
      return undefined;
    return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board)}/postings/${id}`;
  },
  readText: (payload) => {
    const sections = record(record(record(payload).jobAd).sections);
    return ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map((key) => record(sections[key]))
      .map((section) => {
        const body = htmlText(text(section.text));
        const title = text(section.title).trim();
        return body && title ? `${title}\n${body}` : body;
      })
      .filter(Boolean)
      .join('\n\n');
  },
};

/** Id позиции Eightfold живёт в публичной ссылке `/careers/job/<id>`. */
function eightfoldPositionId(
  vacancy: Pick<UnifiedVacancy, 'url'>,
  host: string,
): string | undefined {
  const match = httpsUrl(vacancy.url, host)?.pathname.match(/^\/careers\/job\/(\d+)\/?$/);
  return match?.[1];
}

function eightfoldPcsx(host: string, domain: string): DetailTextSource {
  return {
    format: 'json',
    detailUrl: (_sourceId, vacancy) => {
      const id = eightfoldPositionId(vacancy, host);
      return id
        ? `https://${host}/api/pcsx/position_details?position_id=${id}&domain=${domain}&hl=en`
        : undefined;
    },
    readText: (payload) => htmlText(text(record(record(payload).data).jobDescription)),
  };
}

const netflix: DetailTextSource = {
  format: 'json',
  detailUrl: (_sourceId, vacancy) => {
    const id = eightfoldPositionId(vacancy, 'explore.jobs.netflix.net');
    return id
      ? `https://explore.jobs.netflix.net/api/apply/v2/jobs/${id}?domain=netflix.com`
      : undefined;
  },
  readText: (payload) => htmlText(text(record(payload).job_description)),
};

function isJobPosting(value: unknown): boolean {
  const type = record(value)['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

/** Текст `JobPosting.description` из JSON-LD страницы; битые блоки пропускаются. */
export function readJsonLdJobPosting(html: string): string {
  const blocks = html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? '');
    } catch {
      continue;
    }
    const candidates = [
      parsed,
      ...(Array.isArray(parsed) ? parsed : []),
      ...[record(parsed)['@graph']].flat(),
    ];
    const posting = candidates.find(isJobPosting);
    const description = text(record(posting).description);
    if (description.trim()) return htmlText(decodeFeedEntities(description));
  }
  return '';
}

function jsonLdPage(host: string, path: RegExp): DetailTextSource {
  return {
    format: 'html',
    detailUrl: (_sourceId, vacancy) => {
      const url = httpsUrl(vacancy.url, host);
      return url && path.test(url.pathname) ? `${url.origin}${url.pathname}` : undefined;
    },
    readText: (payload) => (typeof payload === 'string' ? readJsonLdJobPosting(payload) : ''),
  };
}

const LINKEDIN_MARKUP =
  /show-more-less-html__markup[^>]*>([\s\S]*?)(?:<button[^>]*show-more-less-html__button|<\/section>)/;

const linkedin: DetailTextSource = {
  format: 'html',
  intervalMs: 10_000,
  intervalJitterMs: 10_000,
  throttlePauseMs: 60 * 60_000,
  detailUrl: (_sourceId, vacancy) => {
    const match = httpsUrl(vacancy.url, 'www.linkedin.com')?.pathname.match(
      /^\/jobs\/view\/(\d+)\/?$/,
    );
    return match
      ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${match[1]}`
      : undefined;
  },
  readText: (payload) => {
    const markup = typeof payload === 'string' ? payload.match(LINKEDIN_MARKUP)?.[1] : undefined;
    return markup ? htmlText(markup.replace(/<\/div>\s*$/, '')) : '';
  },
};

const APPLE_DATA = /__staticRouterHydrationData\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/;
const APPLE_PARTS = [
  'jobSummary',
  'description',
  'responsibilities',
  'minimumQualifications',
  'preferredQualifications',
] as const;

/**
 * Apple: список отдаёт только `jobSummary`; страница вакансии несёт весь текст
 * в данных роутера `loaderData.jobDetails.jobsData`. robots.txt у
 * jobs.apple.com нет (замер 20.10).
 */
const apple: DetailTextSource = {
  format: 'html',
  detailUrl: (_sourceId, vacancy) => {
    const url = httpsUrl(vacancy.url, 'jobs.apple.com');
    return url && /^\/[a-z]{2}-[a-z]{2}\/details\/[A-Za-z0-9-]+(\/[^/]*)?$/.test(url.pathname)
      ? `${url.origin}${url.pathname}`
      : undefined;
  },
  readText: (payload) => {
    const literal = typeof payload === 'string' ? payload.match(APPLE_DATA)?.[1] : undefined;
    if (!literal) return '';
    let data: unknown;
    try {
      data = JSON.parse(JSON.parse(literal) as string);
    } catch {
      return '';
    }
    const job = record(record(record(record(data).loaderData).jobDetails).jobsData);
    return APPLE_PARTS.map((key) => htmlText(text(job[key])))
      .filter(Boolean)
      .join('\n\n');
  },
};

const BY_ID: Readonly<Record<string, DetailTextSource>> = {
  'src-microsoft-careers': eightfoldPcsx('apply.careers.microsoft.com', 'microsoft.com'),
  'src-qualcomm-careers': eightfoldPcsx('careers.qualcomm.com', 'qualcomm.com'),
  'src-netflix': netflix,
  'src-apple-jobs': apple,
  'src-linkedin-guest': linkedin,
  'src-habr-career': jsonLdPage('career.habr.com', /^\/vacancies\/\d+\/?$/),
  'src-yc-work-at-startup': jsonLdPage(
    'www.ycombinator.com',
    /^\/companies\/[^/]+\/jobs\/[^/]+\/?$/,
  ),
};

export function detailTextSourceFor(sourceId: string): DetailTextSource | undefined {
  if (sourceId.startsWith(WORKDAY_SOURCE_PREFIX)) return workday;
  if (sourceId.startsWith(SMARTRECRUITERS_PREFIX)) return smartRecruiters;
  return BY_ID[sourceId];
}

/** Источник, чей текст дочитывает воркер и чей дочитанный текст сохраняет повторная запись. */
export function isDetailTextSource(sourceId: string): boolean {
  return detailTextSourceFor(sourceId) !== undefined;
}
