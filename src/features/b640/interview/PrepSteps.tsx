import { useEffect, useRef } from 'react';
import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';
import { CtxHead } from '../shell/CtxHead';
import type { ApplicationView } from '../../../../server/domain/applicationDerivedFields';
import { formatInterviewWhen } from './model/prepModel';

export type InterviewStep = 'prep' | 'debrief';

/** Место под затухание у края строки, как у `SecTabs`: текущий шаг под него не уходит. */
const FADE_ROOM = 40;

/** На 390 строка шагов прокручена так, что текущий шаг виден целиком (как в макете i04). */
function useCurrentStepInView(current: InterviewStep) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const step = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !step) return;
    const right = step.offsetLeft - row.offsetLeft + step.offsetWidth;
    if (right > row.clientWidth - FADE_ROOM) row.scrollLeft = right - row.clientWidth + FADE_ROOM;
  }, [current]);
  return rowRef;
}

/**
 * Шаги отклика с интервью: «Отклик · Подготовка · Интервью · Разбор» (I1–I4). Пройденные — с
 * галочкой: на подготовке только «Отклик», на разборе — три шага до него (макет i04).
 */
export function PrepSteps(props: { readonly responseId: string; readonly current: InterviewStep }) {
  const { responseId, current } = props;
  const rowRef = useCurrentStepInView(current);
  const debrief = current === 'debrief';
  return (
    <nav className="tabs sec-tabs r6-steps" aria-label="Шаги">
      <div className="sec-tabs-in" ref={rowRef}>
        <Link to={buildNodePath('o01c', { responseId })}>
          <Icon name="check" />
          Отклик
        </Link>
        <Link
          to={buildNodePath('i01', { responseId })}
          aria-current={current === 'prep' ? 'page' : undefined}
        >
          {debrief ? <Icon name="check" /> : null}
          Подготовка
        </Link>
        <Link to={buildNodePath('o01c', { responseId })}>
          {debrief ? <Icon name="check" /> : null}
          Интервью
        </Link>
        <Link to={buildNodePath('i04', { responseId })} aria-current={debrief ? 'page' : undefined}>
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
