import type { ReactNode } from 'react';
import { StatusLine } from '../kit/ResultLine';
import type { B640Node } from '../routes';
import { StartTemplate, StartWorkplace } from './StartPlan';
import { useAdaptation, type AdaptationData } from './useAdaptation';
import './adaptation.css';

export type AdaptationActions = ReturnType<typeof useAdaptation>;

/** d01g: форма старта — одна колонка, как в макете. */
function EmptyStart({ node, onDone }: { readonly node: B640Node; readonly onDone: () => void }) {
  return (
    <div className="page gb-page" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <StartWorkplace onDone={onDone} />
      </div>
    </div>
  );
}

/** Общая обёртка экранов адаптации: загрузка, ошибка и старт плана на месте экрана. */
export function AdaptationGate({
  node,
  children,
  aside,
  split = false,
}: {
  readonly node: B640Node;
  readonly children: (data: AdaptationData, actions: AdaptationActions) => ReactNode;
  /** Правая колонка макета (на 390 — под основной). */
  readonly aside?: (data: AdaptationData) => ReactNode;
  /** Экран сам раскладывает обе колонки (данные правой колонки грузятся внутри экрана). */
  readonly split?: boolean;
}) {
  const adaptation = useAdaptation();
  const { data } = adaptation;
  if (data.state === 'empty') return <EmptyStart node={node} onDone={adaptation.reload} />;
  if (split && data.state === 'ready' && data.view.hasPlan) {
    return (
      <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
        {children(data, adaptation)}
      </div>
    );
  }
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
        {data.state === 'ready' && !data.view.hasPlan ? <StartTemplate onStart={adaptation.startPlan} /> : null}
        {data.state === 'ready' && data.view.hasPlan ? children(data, adaptation) : null}
      </div>
      {aside && data.state === 'ready' && data.view.hasPlan ? <div className="col">{aside(data)}</div> : null}
    </div>
  );
}
