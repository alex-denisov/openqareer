import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';
import { CtxHead } from '../shell/CtxHead';
import type { ApplicationView } from '../../../../server/domain/applicationDerivedFields';
import { formatInterviewWhen } from './model/prepModel';

export type InterviewStep = 'prep' | 'debrief';

/** Шаги отклика с интервью: «Отклик · Подготовка · Интервью · Разбор» (I1–I4). */
export function PrepSteps(props: { readonly responseId: string; readonly current: InterviewStep }) {
  const { responseId, current } = props;
  return (
    <nav className="tabs sec-tabs r6-steps" aria-label="Шаги">
      <div className="sec-tabs-in">
        <Link to={buildNodePath('o01c', { responseId })}>
          <Icon name="check" />
          Отклик
        </Link>
        <Link
          to={buildNodePath('i01', { responseId })}
          aria-current={current === 'prep' ? 'page' : undefined}
        >
          Подготовка
        </Link>
        <Link to={buildNodePath('o01c', { responseId })}>Интервью</Link>
        <Link
          to={buildNodePath('i04', { responseId })}
          aria-current={current === 'debrief' ? 'page' : undefined}
        >
          Разбор
        </Link>
      </div>
    </nav>
  );
}

/** «Руководитель платформы · Арка Холдинг». */
export function interviewTitle(response: ApplicationView): string {
  return [response.vacancy?.title, response.vacancy?.company].filter(Boolean).join(' · ');
}

/** Когда и как пройдёт встреча: «12 ноября, 15:00», «видеозвонок с техническим директором». */
export function interviewMeta(response: ApplicationView): readonly string[] {
  const when = formatInterviewWhen(response.nearestInterview?.scheduledAt ?? null);
  const format = response.nearestInterview?.format?.trim();
  return [when, format].filter((item): item is string => Boolean(item));
}

/** Шапка контекста: над каким интервью идёт работа. */
export function InterviewHead({ response }: { readonly response: ApplicationView }) {
  const meta = interviewMeta(response);
  return (
    <CtxHead
      kind="Интервью"
      title={interviewTitle(response)}
      meta={meta.length > 0 ? meta : undefined}
      open={{
        path: buildNodePath('o01c', { responseId: response.id }),
        label: 'Открыть: интервью',
      }}
    />
  );
}
