import type { ApplicationView } from '../../../../../server/domain/applicationDerivedFields';
import { CoachApiError } from '../../../coach/apiClient';
import {
  getCurrentInterviewSession,
  startInterviewSession,
  type InterviewSessionView,
} from '../../../interview/interviewSimulatorApi';
import { sessionChoice } from '../model/mockModel';
import { findResponse } from './prepApi';

export type MockLoad =
  | { readonly kind: 'none' }
  | { readonly kind: 'paywall'; readonly response: ApplicationView }
  | { readonly kind: 'other'; readonly response: ApplicationView; readonly session: InterviewSessionView }
  | { readonly kind: 'ready'; readonly response: ApplicationView; readonly session: InterviewSessionView };

function isCode(reason: unknown, code: string): boolean {
  return reason instanceof CoachApiError && reason.code === code;
}

async function startFor(response: ApplicationView): Promise<MockLoad> {
  try {
    const session = await startInterviewSession({
      mode: 'text',
      applicationId: response.id,
      roleTitle: response.vacancy?.title ?? undefined,
      questionTypes: ['behavioral'],
      replaceCompleted: true,
    });
    return { kind: 'ready', response, session };
  } catch (reason) {
    if (isCode(reason, 'paywall_required')) return { kind: 'paywall', response };
    if (!isCode(reason, 'interview_session_active')) throw reason;
    // Начатую параллельно (второй заход экрана) продолжаем, а не заводим новую.
    const current = await getCurrentInterviewSession();
    if (!current) throw reason;
    return { kind: current.applicationId === response.id ? 'ready' : 'other', response, session: current };
  }
}

/** Пробное интервью по отклику: продолжить незаконченное или начать новое. */
export async function loadMock(responseId: string, signal: AbortSignal): Promise<MockLoad> {
  const response = await findResponse(responseId, signal);
  if (!response) return { kind: 'none' };
  const current = await getCurrentInterviewSession(signal);
  const choice = sessionChoice(current, response.id);
  if (current && choice === 'resume') return { kind: 'ready', response, session: current };
  if (current && choice === 'other') return { kind: 'other', response, session: current };
  return startFor(response);
}
