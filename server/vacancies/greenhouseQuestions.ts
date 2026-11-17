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

/** Доска и номер вакансии Greenhouse из записи подбора; не Greenhouse — `null`. */
export function greenhouseJobRef(
  vacancy: Pick<UnifiedVacancy, 'provenance'> | undefined,
): GreenhouseJobRef | null {
  const ref = vacancy ? parseAtsBoardSourceId(vacancy.provenance.sourceId) : null;
  const jobId = vacancy?.provenance.externalId ?? '';
  if (!ref || ref.provider !== 'greenhouse') return null;
  return BOARD.test(ref.board) && JOB_ID.test(jobId) ? { board: ref.board, jobId } : null;
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
  try {
    return await withRequestTimeout(READ_TIMEOUT_MS, async (signal) => {
      const response = await fetchImpl(url, { signal, redirect: 'error', headers: { accept: 'application/json' } });
      if (!response.ok) return null;
      const body = await response.text();
      if (body.length > MAX_BODY_BYTES) return null;
      return parseGreenhouseQuestions(JSON.parse(body) as unknown);
    });
  } catch {
    return null;
  }
}
