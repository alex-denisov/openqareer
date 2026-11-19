import type { ReactNode } from 'react';
import { StatusLine } from '../kit/ResultLine';
import type { B640Node } from '../routes';
import { StartTemplate, StartWorkplace } from './StartPlan';
import { useAdaptation, type AdaptationData } from './useAdaptation';
import './adaptation.css';

export type AdaptationActions = ReturnType<typeof useAdaptation>;

/** Общая обёртка экранов адаптации: загрузка, ошибка и старт плана на месте экрана. */
export function AdaptationGate({
  node,
  children,
  aside,
}: {
  readonly node: B640Node;
  readonly children: (data: AdaptationData, actions: AdaptationActions) => ReactNode;
  /** Правая колонка макета (на 390 — под основной). */
  readonly aside?: (data: AdaptationData) => ReactNode;
}) {
  const adaptation = useAdaptation();
  const { data } = adaptation;
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        {data.state === 'loading' ? <StatusLine state="wait" text="Загружаем план адаптации" /> : null}
        {data.state === 'error' ? (
          <StatusLine
            state="err"
            text="План адаптации не загрузился"
            action={
              <button className="row-act" type="button" onClick={adaptation.reload}>
                Повторить
              </button>
            }
          />
        ) : null}
        {data.state === 'empty' ? <StartWorkplace onDone={adaptation.reload} /> : null}
        {data.state === 'ready' && !data.view.hasPlan ? <StartTemplate onStart={adaptation.startPlan} /> : null}
        {data.state === 'ready' && data.view.hasPlan ? children(data, adaptation) : null}
      </div>
      {aside && data.state === 'ready' && data.view.hasPlan ? <div className="col">{aside(data)}</div> : null}
    </div>
  );
}
