import type { ApplicationView } from '../../../../../server/domain/applicationDerivedFields';
import type { StarStoryView } from '../../../../../shared/starStories';
import { listApplicationsPool } from '../../../applications/applicationsApi';
import { apiFetch, readDataObject } from '../../../coach/apiClient';
import { getDecisionProfile } from '../../../coach/decisionProfileApi';
import { generateInterviewPrepBrief } from '../../../interview/interviewPrepEngine';
import { getStarStories } from '../../../interview/starStoriesApi';
import { pickNextResponse, type PrepParagraph, type PrepQuestion } from '../model/prepModel';

export interface SalaryFloor {
  readonly amount: number;
  readonly currency: string;
}

export interface PrepData {
  readonly response: ApplicationView;
  readonly questions: readonly PrepQuestion[];
  readonly askThem: readonly string[];
  readonly paragraphs: readonly PrepParagraph[];
  readonly stories: readonly StarStoryView[];
  readonly floor: SalaryFloor | null;
}

interface StarPrepView {
  readonly paragraphs: readonly PrepParagraph[];
}

const starPrepPath = (applicationId: string) =>
  `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/star-prep`;

/** Истории и планка — дополнение: без них экран показывает вопросы как есть. */
async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

async function salaryFloor(signal: AbortSignal): Promise<SalaryFloor | null> {
  const profile = await optional(() => getDecisionProfile(signal));
  if (!profile?.salaryFloor) return null;
  return { amount: profile.salaryFloor, currency: profile.salaryCurrency ?? 'RUB' };
}

async function getStarPrep(applicationId: string, signal: AbortSignal): Promise<StarPrepView> {
  return readDataObject<StarPrepView>(await apiFetch(starPrepPath(applicationId), { signal }));
}

export async function putStarPrep(
  applicationId: string,
  paragraphs: readonly PrepParagraph[],
): Promise<readonly PrepParagraph[]> {
  const response = await apiFetch(starPrepPath(applicationId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paragraphs }),
  });
  return (await readDataObject<StarPrepView>(response)).paragraphs;
}

/** Отклик по адресу; `next` — ближайшее интервью. `null` — такого отклика нет. */
export async function findResponse(
  responseId: string,
  signal: AbortSignal,
): Promise<ApplicationView | null> {
  const pool = await listApplicationsPool({}, signal);
  return responseId === 'next'
    ? pickNextResponse(pool.items, new Date())
    : (pool.items.find((item) => item.id === responseId) ?? null);
}

/** Подготовка к интервью отклика; `null` — откликов с интервью нет. */
export async function loadPrep(responseId: string, signal: AbortSignal): Promise<PrepData | null> {
  const response = await findResponse(responseId, signal);
  if (!response) return null;
  const brief = generateInterviewPrepBrief({
    vacancy: {
      id: response.id,
      title: response.vacancy?.title ?? '',
      company: response.vacancy?.company ?? undefined,
    },
    facts: [],
  });
  const [prep, stories, floor] = await Promise.all([
    getStarPrep(response.id, signal),
    optional(() => getStarStories(signal)),
    salaryFloor(signal),
  ]);
  return {
    response,
    questions: brief.starQuestions.map(({ id, question }) => ({ id, question })),
    askThem: brief.counterQuestions,
    paragraphs: prep.paragraphs,
    stories: stories?.stories ?? [],
    floor,
  };
}
