/**
 * B646-5 — чтение доски Paycom.
 *
 * Перенесено из freehire (MIT, Copyright (c) 2026 freehire contributors; см.
 * NOTICE): internal/ingest/sources/paycom.go и providers/paycom.md.
 *
 * Портал — JS-приложение: его страница несёт сессионный JWT портала и
 * региональный хост API («Mantle»). С этим JWT в Authorization поиск
 * `job-posting-previews/search` листается по skip/take. Полной выдача
 * считается только дочитанная до заявленного `jobPostingPreviewsCount`;
 * сбой страницы, пустая страница до итога, ответ без итога и потолок страниц
 * оставляют чтение частичным (freehire 2026-10-29). JWT — пропуск портала, не
 * секрет владельца, но в журналы и ошибки он всё равно не попадает.
 *
 * ВНИМАНИЕ: robots.txt хоста API (2026-11-11) разрешает только
 * `/api/ats/job-postings/` и `/api/ats/company-name`; поиск превью запрещён,
 * поэтому контракт Paycom — `robots_forbidden`, и движок этот путь не
 * опрашивает, пока владелец не решит иначе.
 */
import { PAYCOM_PORTAL_BASE } from './atsListingReaders';
import { withRequestTimeout } from './requestTimeout';

const PAYCOM_TIMEOUT_MS = 30_000;
const PAYCOM_PAGE = 50;
/** Самая большая доска freehire 2026-10-29 — 2705 вакансий, 55 страниц. */
const PAYCOM_PAGES_PER_SYNC = 60;
const PAYCOM_PAGE_DELAY_MS = 500;
/** Снятая доска отвечает 200 с этой фразой вместо портала; совпадение по началу фразы. */
const PAYCOM_NO_SUCH_BOARD = 'Job board does not exist';
const SESSION_JWT = /"sessionJWT":"([^"]+)"/;
const MANTLE_HOST = /portal-applicant-tracking\.[a-z0-9-]+\.paycomonline\.net/;

type Fetch = typeof fetch;

export interface PaycomBoardReading {
  readonly payload: { companyName: string; jobPostingPreviews: unknown[] };
  readonly partial: boolean;
}

function unreachable(status: number): Error {
  return Object.assign(new Error(`vacancy_source_unreachable: ${status}`), { statusCode: status });
}

async function request(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  read: 'text' | 'json',
): Promise<unknown> {
  return withRequestTimeout(PAYCOM_TIMEOUT_MS, async (signal) => {
    const res = await fetchImpl(url, { ...init, signal });
    if (!res.ok) throw unreachable(res.status);
    return read === 'text' ? res.text() : res.json();
  });
}

function searchBody(skip: number): unknown {
  // Фильтры обязаны лежать в filtersForQuery: фильтр верхнего уровня молча даёт ноль.
  return {
    skip,
    take: PAYCOM_PAGE,
    filtersForQuery: {
      distanceFrom: 0,
      workEnvironments: [],
      positionTypes: [],
      educationLevels: [],
      categories: [],
      travelTypes: [],
      shiftTypes: [],
      otherFilters: [],
      keywordSearchText: '',
      location: '',
      sortOption: '',
    },
  };
}

async function bootstrap(
  fetchImpl: Fetch,
  board: string,
): Promise<{ jwt: string; mantle: string }> {
  // Любой id вакансии в пути отдаёт ту же оболочку портала.
  const page = String(
    await request(
      fetchImpl,
      `${PAYCOM_PORTAL_BASE}/${encodeURIComponent(board)}/jobs/1`,
      {},
      'text',
    ),
  );
  if (page.includes(PAYCOM_NO_SUCH_BOARD)) throw new Error('vacancy_source_board_gone');
  const jwt = SESSION_JWT.exec(page)?.[1] ?? '';
  const mantle = MANTLE_HOST.exec(page)?.[0] ?? '';
  if (!jwt || !mantle) throw new Error('vacancy_source_payload_unreadable');
  return { jwt, mantle: `https://${mantle}` };
}

async function companyName(
  fetchImpl: Fetch,
  mantle: string,
  headers: HeadersInit,
): Promise<string> {
  try {
    const body = await request(fetchImpl, `${mantle}/api/ats/company-name`, { headers }, 'json');
    const name = (body as { companyName?: unknown } | null)?.companyName;
    return typeof name === 'string' ? name : '';
  } catch {
    return ''; // имя назовёт реестр
  }
}

interface PreviewPage {
  readonly count: number | null;
  readonly previews: readonly Record<string, unknown>[];
}

async function previewPage(
  fetchImpl: Fetch,
  mantle: string,
  headers: HeadersInit,
  skip: number,
): Promise<PreviewPage> {
  const body = (await request(
    fetchImpl,
    `${mantle}/api/ats/job-posting-previews/search`,
    { method: 'POST', headers, body: JSON.stringify(searchBody(skip)) },
    'json',
  )) as { jobPostingPreviewsCount?: unknown; jobPostingPreviews?: unknown } | null;
  const count = body?.jobPostingPreviewsCount;
  const previews = Array.isArray(body?.jobPostingPreviews) ? body.jobPostingPreviews : [];
  return {
    count: typeof count === 'number' && Number.isFinite(count) ? count : null,
    previews: previews.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object'),
  };
}

/** Доска Paycom целиком или честно частичное чтение; сбой первой страницы — отказ. */
export async function fetchPaycomBoard(
  board: string,
  fetchImpl: Fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<PaycomBoardReading> {
  const { jwt, mantle } = await bootstrap(fetchImpl, board);
  const headers = {
    Authorization: jwt,
    Locale: 'en-US',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const name = await companyName(fetchImpl, mantle, headers);
  const seen = new Map<string, Record<string, unknown>>();
  const done = (partial: boolean): PaycomBoardReading => ({
    payload: { companyName: name, jobPostingPreviews: [...seen.values()] },
    partial,
  });
  for (let page = 0; page < PAYCOM_PAGES_PER_SYNC; page += 1) {
    if (page > 0) await sleep(PAYCOM_PAGE_DELAY_MS);
    let result: PreviewPage;
    try {
      result = await previewPage(fetchImpl, mantle, headers, page * PAYCOM_PAGE);
    } catch (err) {
      if (page === 0) throw err;
      return done(true);
    }
    for (const preview of result.previews) {
      const id = String(preview.jobId ?? '');
      if (id && !seen.has(id)) seen.set(id, preview);
    }
    // Ответ без итога не читается как «итог 0» и не закрывает доску полной.
    if (result.count === null) return done(true);
    if (seen.size >= result.count) return done(false);
    if (result.previews.length === 0) return done(true);
  }
  return done(true);
}
