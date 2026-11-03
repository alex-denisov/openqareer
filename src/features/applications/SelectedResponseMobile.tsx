import { CaretRight, Target } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { ApplicationView } from './applicationsApi';
import { formatDayMonthTime, responseNextStep } from './responseCardFace';
import { humanSourceLabel } from './sourceLabels';
import './responses-mobile-process.css';

/**
 * Pieces of the selected response that exist for the 390 «Процесс» push
 * (mockup 5 `proc`, B511 G3 item 4): the subline under the company and the
 * next step as a tappable group row. The 1440 panel hides them in CSS.
 */

/** «VP Engineering · hh.ru · интервью 10.10, 14:00»; missing parts are left out. */
export function responseSubline(application: ApplicationView): string {
  const interviewAt = formatDayMonthTime(application.nearestInterview?.scheduledAt);
  return [
    application.vacancy?.title,
    application.vacancy?.source ? humanSourceLabel(application.vacancy.source) : null,
    interviewAt ? `интервью ${interviewAt}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** The date the next step is due: the interview it prepares for, otherwise the reminder. */
export function stepDeadline(application: ApplicationView): string | null | undefined {
  if (application.stage === 'interview' && application.nearestInterview?.scheduledAt) {
    return application.nearestInterview.scheduledAt;
  }
  return application.followUp?.dueAt ?? application.followUpDueAt;
}

export function daysLeft(value: string | null | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const due = new Date(value).getTime();
  if (Number.isNaN(due)) return null;
  const days = Math.ceil((due - now) / 86_400_000);
  if (days < 0) return 'Срок прошёл';
  if (days === 0) return 'Срок сегодня';
  return `Осталось ${pluralRu(days, ['день', 'дня', 'дней'])}`;
}

export function NextStepRow({
  application,
  onOpen,
}: {
  readonly application: ApplicationView;
  /** Performs or opens the step; without it the row is plain text. */
  readonly onOpen?: () => void;
}) {
  const next = responseNextStep(application);
  const left = daysLeft(stepDeadline(application));
  const content = (
    <>
      <span className="career-responses-selected__row-icon">
        <Target aria-hidden="true" />
      </span>
      <span className="career-responses-selected__row-text">
        <strong>{next.text}</strong>
        {left ? <small>{left}</small> : null}
      </span>
      {onOpen ? (
        <CaretRight className="career-responses-selected__chevron" aria-hidden="true" />
      ) : null}
    </>
  );
  return (
    <section
      className="career-responses-selected__step"
      aria-labelledby="career-responses-step-title"
    >
      <h3 id="career-responses-step-title" className="career-subsection-title">
        Следующий шаг
      </h3>
      <div className="career-responses-selected__rows">
        {onOpen ? (
          <button type="button" className="career-responses-selected__row is-link" onClick={onOpen}>
            {content}
          </button>
        ) : (
          <div className="career-responses-selected__row">{content}</div>
        )}
      </div>
    </section>
  );
}
