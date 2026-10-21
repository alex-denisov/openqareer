import type { FormEvent, ReactNode } from 'react';
import { VacancyInterviewForm } from './VacancyInterviewForm';

export interface PushRowState {
  readonly interviewState: {
    readonly scheduleOpen: boolean;
    readonly setScheduleOpen: (open: boolean) => void;
    readonly scheduledLocal: string;
    readonly setScheduledLocal: (value: string) => void;
    readonly savingSchedule: boolean;
    readonly scheduleError?: string;
    readonly handleScheduleSubmit: (event: FormEvent) => Promise<void>;
  };
  readonly appliedState: {
    readonly appliedError?: string;
    readonly handleConfirmAlreadyApplied: () => Promise<void>;
  };
}

/** The 390 push reuses the 1440 row's interview and «Я уже откликнулся» handlers (B510). */
export function vacancyPushRowActions(
  rowProps: { readonly onScheduleInterview?: unknown; readonly onMarkAlreadyApplied?: unknown },
  { interviewState, appliedState }: PushRowState,
): {
  readonly onScheduleInterview?: () => void;
  readonly onConfirmAlreadyApplied?: () => void;
  readonly interviewForm: ReactNode;
} {
  return {
    onScheduleInterview: rowProps.onScheduleInterview
      ? () => interviewState.setScheduleOpen(true)
      : undefined,
    onConfirmAlreadyApplied: rowProps.onMarkAlreadyApplied
      ? () => void appliedState.handleConfirmAlreadyApplied()
      : undefined,
    interviewForm: (
      <>
        {appliedState.appliedError ? (
          <p className="vacancies-interview-error" role="alert">
            {appliedState.appliedError}
          </p>
        ) : null}
        {interviewState.scheduleOpen ? (
          <VacancyInterviewForm
            scheduledLocal={interviewState.scheduledLocal}
            savingSchedule={interviewState.savingSchedule}
            scheduleError={interviewState.scheduleError}
            onChangeDate={interviewState.setScheduledLocal}
            onClose={() => interviewState.setScheduleOpen(false)}
            onSubmit={(event) => void interviewState.handleScheduleSubmit(event)}
          />
        ) : null}
      </>
    ),
  };
}
