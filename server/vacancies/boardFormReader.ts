import type { QuestionnaireQuestion } from '../../shared/applicationQuestionnaire';
import { parseRecruiteeQuestions, parseTeamtailorQuestions } from '../domain/boardFormQuestions';
import { readLimited } from './limitedBody';
import { withRequestTimeout } from './requestTimeout';

/** B787: открытая форма отклика Recruitee или Teamtailor. */
export interface BoardFormRef {
  readonly board: 'recruitee' | 'teamtailor';
  readonly host: string;
  readonly job: string;
}

const READ_TIMEOUT_MS = 8_000;
const FAILURE_PAUSE_MS = 15 * 60 * 1000;
const MAX_REMEMBERED_FAILURES = 500;
const HOST = /^[a-z0-9][a-z0-9-]{0,62}(?:\.na)?\.(recruitee|teamtailor)\.com$/u;
const RECRUITEE_PATH = /^(?:\/[a-z]{2})?\/o\/([a-z0-9][a-z0-9-]{0,200})(?:\/|$)/u;
const TEAMTAILOR_PATH = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/jobs\/(\d{1,20})(?:[-/]|$)/iu;

const failedUntil = new Map<string, number>();
const inFlight = new Map<string, Promise<readonly QuestionnaireQuestion[] | null>>();

/** Вакансия по её адресу; чужой хост, порт или логин в адресе — `null`. */
export function boardFormRef(value: string | undefined): BoardFormRef | null {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  const board = HOST.exec(url.hostname)?.[1];
  const path = board === 'recruitee' ? RECRUITEE_PATH : TEAMTAILOR_PATH;
  const job = path.exec(url.pathname)?.[1];
  if (!job || (board !== 'recruitee' && board !== 'teamtailor')) return null;
  return { board, host: url.hostname, job };
}

const addressOf = ({ board, host, job }: BoardFormRef): string =>
  board === 'recruitee'
    ? `https://${host}/api/offers/${job}`
    : `https://${host}/jobs/${job}/applications/new`;

async function fetchQuestions(
  ref: BoardFormRef,
  fetchImpl: typeof fetch,
): Promise<readonly QuestionnaireQuestion[] | null> {
  try {
    return await withRequestTimeout(READ_TIMEOUT_MS, async (signal) => {
      const accept = ref.board === 'recruitee' ? 'application/json' : 'text/html';
      const response = await fetchImpl(addressOf(ref), {
        signal,
        redirect: 'error',
        headers: { accept },
      });
      if (!response.ok) return null;
      const body = await readLimited(response);
      if (body === null) return null;
      return ref.board === 'recruitee'
        ? parseRecruiteeQuestions(JSON.parse(body) as unknown, ref.job)
        : parseTeamtailorQuestions(body, ref.job);
    });
  } catch {
    return null;
  }
}

function rememberFailure(key: string): void {
  if (failedUntil.size >= MAX_REMEMBERED_FAILURES) {
    const oldest = failedUntil.keys().next().value;
    if (oldest !== undefined) failedUntil.delete(oldest);
  }
  failedUntil.set(key, Date.now() + FAILURE_PAUSE_MS);
}

/** Вопросы формы; не прочиталась — `null`, четверть часа не повторяем. */
export async function readBoardFormQuestions(
  ref: BoardFormRef,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly QuestionnaireQuestion[] | null> {
  const key = addressOf(ref);
  if ((failedUntil.get(key) ?? 0) > Date.now()) return null;
  const running = inFlight.get(key);
  if (running) return running;
  const read = fetchQuestions(ref, fetchImpl).then((questions) => {
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

/** Для тестов: забыть сбои и идущие чтения. */
export function resetBoardFormCache(): void {
  failedUntil.clear();
  inFlight.clear();
}
