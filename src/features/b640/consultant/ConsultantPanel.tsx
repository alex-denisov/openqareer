import { useId } from 'react';
import type { CoachTurnStage } from '../../coach/coachApi';
import { Icon } from '../kit/Icon';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { DialogView } from './DialogView';
import { ConversationView, HistoryView } from './HistoryView';
import { panelTitle } from './model';

/** Что открыто в панели: текущий разговор, список разговоров или прошлый разговор. */
export type PanelView =
  | { readonly kind: 'dialog' }
  | { readonly kind: 'history' }
  | { readonly kind: 'conversation'; readonly id: string };

export interface ConsultantPanelProps {
  readonly view: PanelView;
  /** Тема разговора: раздел, над которым открыта панель. */
  readonly stage: CoachTurnStage;
  /** Раздел под панелью назван в заголовке; `false` — панель открыта сама по себе. */
  readonly named: boolean;
  /** Адрес каждого вида панели: её открывает и адрес раздела, и оболочка поверх экрана. */
  readonly pathOf: (view: PanelView) => string;
  readonly onView: (view: PanelView) => void;
  readonly onClose: () => void;
}

const REVIEW_PATH = buildNodePath('p06');
const TARIFFS_PATH = buildNodePath('t01');

/**
 * Панель консультанта (макеты K1–K7): на 1440 и 1176 — третья колонка сетки `.app.has-panel`,
 * на 390 — лист снизу. Ставится соседом `main` внутри `.app`.
 */
export function ConsultantPanel({ view, stage, named, pathOf, onView, onClose }: ConsultantPanelProps) {
  const titleId = useId();
  const list = view.kind === 'history';
  return (
    <>
      <div className="backdrop only-mob" aria-hidden="true" onClick={onClose} />
      <aside className="panel-col" aria-labelledby={titleId} data-b640-panel={view.kind}>
        <span className="grab" aria-hidden="true" />
        <header className="panel-head ph2">
          {list ? (
            <h2 className="ph-title" id={titleId}>
              Все разговоры
            </h2>
          ) : (
            <>
              <Link className="ph-back" to={pathOf({ kind: 'history' })} aria-label="Все разговоры">
                <Icon name="left" />
                <span className="ph-back-l">Все разговоры</span>
              </Link>
              <h2 className="ph-title ph-conv" id={titleId}>
                {panelTitle(named ? stage : null)}
              </h2>
            </>
          )}
          <div className="head-acts">
            <button className="icon-btn" type="button" aria-label="Свернуть" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </header>
        {view.kind === 'dialog' ? (
          <DialogView stage={stage} reviewPath={REVIEW_PATH} tariffsPath={TARIFFS_PATH} />
        ) : null}
        {view.kind === 'history' ? (
          <HistoryView
            conversationPath={(id) => pathOf({ kind: 'conversation', id })}
            onStart={() => onView({ kind: 'dialog' })}
          />
        ) : null}
        {view.kind === 'conversation' ? <ConversationView key={view.id} id={view.id} /> : null}
      </aside>
    </>
  );
}
