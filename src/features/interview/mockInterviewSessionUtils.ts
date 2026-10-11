import { CoachApiError } from '../coach/apiClient';
import type { InterviewUiError } from './mockInterviewSessionTypes';

export function toInterviewUiError(reason: unknown, fallback: string): InterviewUiError {
  return reason instanceof CoachApiError
    ? { code: reason.code, message: reason.message }
    : { message: fallback };
}
