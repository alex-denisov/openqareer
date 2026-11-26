/**
 * B646-5 — разбор списков Paylocity, Join и Paycom.
 *
 * Перенесено из freehire (MIT, Copyright (c) 2026 freehire contributors; см.
 * NOTICE): internal/ingest/sources/paylocity.go, join.go, paycom.go и
 * providers/paycom.md. У всех трёх полный текст вакансии лежит только в
 * карточке, а карточку мы не запрашиваем: текст здесь — то, что отдаёт сам
 * список (обрезок описания, отдел, категория). Придумывать содержание
 * запрещено (B161).
 */
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import {
  asArray,
  buildJsonVacancy,
  fromIso,
  fromLooseDate,
  listOf,
  record,
  text,
  UNREADABLE,
  type JsonAdapterContext,
} from './jsonVacancyRecord';

export const PAYLOCITY_BASE = 'https://recruiting.paylocity.com';
export const JOIN_PAGE_SIZE = 5;
export const PAYCOM_PORTAL_BASE = 'https://www.paycomonline.net/v4/ats/web.php/portal';

/** IndeedRemoteType = 1 страница Paylocity подписывает «Hybrid Remote» (freehire, 2026-10-23). */
const PAYLOCITY_HYBRID_REMOTE_TYPE = 1;
const REMOTE_WORDS = /\bremote\b/i;

function employer(published: string, context: JsonAdapterContext, board: string): string {
  return published.trim() || context.sourceName?.trim() || board;
}

function joinParts(parts: readonly string[], separator: string): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(separator);
}

/** Конец JSON-массива, начатого на `start`, с учётом строк и экранирования. */
function arrayEnd(source: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Список Paylocity — HTML, в котором `window.pageData` несёт весь массив
 * `Jobs` доски одним запросом, без страниц. `null` — массива нет: это не
 * пустая доска (пустая отдаёт `"Jobs":[]`), а нечитаемый ответ.
 */
export function extractPaylocityJobs(html: string): unknown[] | null {
  const key = html.indexOf('"Jobs":');
  if (key < 0) return null;
  const start = html.indexOf('[', key);
  if (start < 0) return null;
  const end = arrayEnd(html, start);
  if (end < 0) return null;
  try {
    return asArray(JSON.parse(html.slice(start, end + 1)));
  } catch {
    return null;
  }
}

/**
 * Флаг IsRemote с типом 1 — гибрид, с другим типом — полная удалёнка; без флага
 * решает подпись места («Remote Worker»). Тип без флага ничего не значит: 2
 * стоит почти у всех офисных вакансий (freehire: 731 из 733).
 */
function paylocityRemote(job: Record<string, unknown>, locationName: string): boolean {
  if (job.IsRemote === true) return job.IndeedRemoteType !== PAYLOCITY_HYBRID_REMOTE_TYPE;
  return REMOTE_WORDS.test(locationName);
}

export function readPaylocity(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
  board: string,
): UnifiedVacancy[] {
  const jobs = typeof payload === 'string' ? extractPaylocityJobs(payload) : null;
  if (!jobs) throw new Error(UNREADABLE);
  return jobs.map((item) => {
    const job = record(item);
    const id = text(job.JobId);
    const locationName = text(job.LocationName);
    const country = text(record(job.JobLocation).Country);
    return buildJsonVacancy({
      sourceId,
      context,
      externalId: id,
      title: text(job.JobTitle),
      company: employer('', context, board),
      location: joinParts([locationName, country], ', ') || undefined,
      isRemote: paylocityRemote(job, locationName),
      // Description в списке — обрезок в ~110 знаков; полный текст только в карточке.
      description:
        joinParts([text(job.HiringDepartment), text(job.Description)], '\n') || text(job.JobTitle),
      skills: [],
      url: id ? `${PAYLOCITY_BASE}/Recruiting/Jobs/Details/${id}` : '',
      publishedAt: fromIso(job.PublishedDate),
    });
  });
}

export function readJoin(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
  board: string,
): UnifiedVacancy[] {
  return listOf(payload, (value) => asArray(record(value).items)).map((item) => {
    const job = record(item);
    const city = record(job.city);
    const location = joinParts([text(city.cityName), text(city.countryName)], ', ');
    const idParam = text(job.idParam);
    const employmentType = text(record(job.employmentType).name);
    return buildJsonVacancy({
      sourceId,
      context,
      externalId: text(job.id),
      title: text(job.title),
      company: employer('', context, board),
      location: location || undefined,
      // workplaceType — главный признак; подпись места — запасной, название не в счёт.
      isRemote: text(job.workplaceType) === 'REMOTE' || REMOTE_WORDS.test(location),
      // Список Join текста не несёт — описание есть только у карточки.
      description: joinParts([text(job.title), text(record(job.category).name)], ' · '),
      skills: [],
      employmentType: employmentType || undefined,
      // join.com/companies/<id>/<idParam> отвечает 301 на страницу с доменом компании.
      url: idParam ? `https://join.com/companies/${board}/${idParam}` : '',
      publishedAt: fromIso(job.createdAt),
    });
  });
}

export function readPaycom(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
  board: string,
): UnifiedVacancy[] {
  const company = employer(text(record(payload).companyName), context, board);
  return listOf(payload, (value) => asArray(record(value).jobPostingPreviews)).map((item) => {
    const job = record(item);
    const id = text(job.jobId);
    const location = text(job.locations);
    return buildJsonVacancy({
      sourceId,
      context,
      externalId: id,
      title: text(job.jobTitle),
      company,
      location: location || undefined,
      isRemote: /^remote$/i.test(text(job.remoteType).trim()) || REMOTE_WORDS.test(location),
      // Превью несёт обрезок описания; полный текст — в карточке job-postings/<id>.
      description: text(job.description) || text(job.jobTitle),
      skills: [],
      employmentType: text(job.positionType) || undefined,
      url: id ? `${PAYCOM_PORTAL_BASE}/${board}/jobs/${id}` : '',
      // postedOn в превью пуст на живой доске (2026-11-11): дата только в карточке.
      publishedAt: fromLooseDate(job.postedOn),
    });
  });
}
