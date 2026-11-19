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

/** Шапка контекста: над каким интервью идёт работа. */
export function InterviewHead({ response }: { readonly response: ApplicationView }) {
  const when = formatInterviewWhen(response.nearestInterview?.scheduledAt ?? null);
  return (
    <CtxHead
      kind="Интервью"
      title={[response.vacancy?.title, response.vacancy?.company].filter(Boolean).join(' · ')}
      meta={when ? [when] : undefined}
      open={{
        path: buildNodePath('o01c', { responseId: response.id }),
        label: 'Открыть: интервью',
      }}
    />
  );
}
