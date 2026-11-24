import type { QuestionnaireQuestion } from '../../shared/applicationQuestionnaire';
import { parseGreenhouseQuestions } from '../domain/applicationQuestionnaire';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { parseAtsBoardSourceId } from './atsBoardAdapters';
import { withRequestTimeout } from './requestTimeout';

const GREENHOUSE_API = 'https://boards-api.greenhouse.io/v1/boards';
const READ_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 512_000;
const BOARD = /^[A-Za-z0-9_-]{1,100}$/u;
const JOB_ID = /^[0-9]{1,20}$/u;

export interface GreenhouseJobRef {
  readonly board: string;
  readonly jobId: string;
}

/** Страницы вакансий Greenhouse, включая домен EU: вопросы всех досок отдаёт один открытый API. */
const BOARD_HOSTS: ReadonlySet<string> = new Set([
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'boards.eu.greenhouse.io',
  'job-boards.eu.greenhouse.io',
]);

/** Доска и номер из адреса страницы: вакансия могла прийти не с самой доски Greenhouse. */
function refFromUrl(value: string | undefined): GreenhouseJobRef | null {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  if (!BOARD_HOSTS.has(url.hostname)) return null;
  const [, board = '', section, jobId = ''] = url.pathname.split('/');
  return section === 'jobs' && BOARD.test(board) && JOB_ID.test(jobId) ? { board, jobId } : null;
}

/** Доска и номер вакансии Greenhouse из записи подбора или её адреса; не Greenhouse — `null`. */
export function greenhouseJobRef(
  vacancy: (Pick<UnifiedVacancy, 'provenance'> & Partial<Pick<UnifiedVacancy, 'url'>>) | undefined,
): GreenhouseJobRef | null {
  const ref = vacancy ? parseAtsBoardSourceId(vacancy.provenance.sourceId) : null;
  const jobId = vacancy?.provenance.externalId ?? '';
  if (ref?.provider === 'greenhouse' && BOARD.test(ref.board) && JOB_ID.test(jobId)) {
    return { board: ref.board, jobId };
  }
  return refFromUrl(vacancy?.url);
}

/**
 * Вопросы анкеты из открытого Job Board API Greenhouse. Адрес собирается только из
 * проверенных доски и номера на одном известном хосте; ответ читается как чужие данные.
 * Сеть или формат подвели — `null`: анкету кандидат откроет на странице работодателя.
 */
export async function readGreenhouseQuestions(
  ref: GreenhouseJobRef,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly QuestionnaireQuestion[] | null> {
  const url = `${GREENHOUSE_API}/${encodeURIComponent(ref.board)}/jobs/${ref.jobId}?questions=true`;
  const key = `${ref.board}:${ref.jobId}`;
  if ((failedUntil.get(key) ?? 0) > Date.now()) return null;
  const running = inFlight.get(key);
  if (running) return running;
  const read = fetchQuestions(url, fetchImpl).then((questions) => {
    if (questions === null) rememberFailure(key);
    return questions;
  });
  inFlight.set(key, read);
  try {
    return await read;
  } finally {
    inFlight.delete(key);
  }
}

/** После сбоя ту же вакансию не читаем четверть часа: кандидат не гоняет сервер к площадке. */
const FAILURE_PAUSE_MS = 15 * 60 * 1000;
const MAX_REMEMBERED_FAILURES = 500;
const failedUntil = new Map<string, number>();
const inFlight = new Map<string, Promise<readonly QuestionnaireQuestion[] | null>>();

function rememberFailure(key: string): void {
  if (failedUntil.size >= MAX_REMEMBERED_FAILURES) {
    const oldest = failedUntil.keys().next().value;
    if (oldest !== undefined) failedUntil.delete(oldest);
  }
  failedUntil.set(key, Date.now() + FAILURE_PAUSE_MS);
}

/** Для тестов: забыть сбои и идущие чтения. */
export function resetGreenhouseQuestionsCache(): void {
  failedUntil.clear();
  inFlight.clear();
}

/** Тело читается потоком и обрывается на пределе: чужой ответ не занимает память без меры. */
async function readLimited(response: Response): Promise<string | null> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchQuestions(
  url: string,
  fetchImpl: typeof fetch,
): Promise<readonly QuestionnaireQuestion[] | null> {
  try {
    return await withRequestTimeout(READ_TIMEOUT_MS, async (signal) => {
      const response = await fetchImpl(url, { signal, redirect: 'error', headers: { accept: 'application/json' } });
      if (!response.ok) return null;
      const body = await readLimited(response);
      return body === null ? null : parseGreenhouseQuestions(JSON.parse(body) as unknown);
    });
  } catch {
    return null;
  }
}
