import { useEffect, useId } from 'react';
import type { CoachTurnStage } from '../../coach/coachApi';
import { Icon } from '../kit/Icon';
import { hasOpenModal } from '../kit/useModalFocus';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { DialogView } from './DialogView';
import { ConversationView, HistoryView } from './HistoryView';
import { panelTitle } from './model';
import type { PanelView } from './panelRoute';

export type { PanelView };

export interface ConsultantPanelProps {
  readonly view: PanelView;
  /** Тема разговора: раздел, над которым открыта панель. */
  readonly stage: CoachTurnStage;
  /** Раздел под панелью назван в заголовке; `false` — панель открыта сама по себе. */
  readonly named: boolean;
  /** Адрес вида панели: ссылка открывается и в новой вкладке. */
  readonly pathOf: (view: PanelView) => string;
  readonly onView: (view: PanelView) => void;
  readonly onClose: () => void;
}

const REVIEW_PATH = buildNodePath('p06');
const TARIFFS_PATH = buildNodePath('t01');

interface PanelHeadProps {
  readonly titleId: string;
  /** Заголовок разговора; `null` — открыт список разговоров. */
  readonly conversation: string | null;
  readonly historyPath: string;
  readonly onHistory: () => void;
  readonly onClose: () => void;
}

function PanelHead({ titleId, conversation, historyPath, onHistory, onClose }: PanelHeadProps) {
  return (
    <header className="panel-head ph2">
      {conversation === null ? (
        <h2 className="ph-title" id={titleId}>
          Все разговоры
        </h2>
      ) : (
        <>
          <Link
            className="ph-back"
            to={historyPath}
            aria-label="Все разговоры"
            onClick={(event) => {
              event.preventDefault();
              onHistory();
            }}
          >
            <Icon name="left" />
            <span className="ph-back-l">Все разговоры</span>
          </Link>
          <h2 className="ph-title ph-conv" id={titleId}>
            {conversation}
          </h2>
        </>
      )}
      <div className="head-acts">
        <button className="icon-btn" type="button" aria-label="Свернуть" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
    </header>
  );
}

/** Esc закрывает панель, если поверх неё не открыто окно. */
function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !hasOpenModal()) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/**
 * Панель консультанта (макеты K1–K7): на 1440 и 1176 — третья колонка сетки `.app.has-panel`,
 * на 390 — лист снизу. Ставится соседом `main` внутри `.app`.
 */
export function ConsultantPanel({ view, stage, named, pathOf, onView, onClose }: ConsultantPanelProps) {
  const titleId = useId();
  useEscape(onClose);
  return (
    <>
      <div className="backdrop only-mob" aria-hidden="true" onClick={onClose} />
      <aside
        className="panel-col"
        role="dialog"
        aria-labelledby={titleId}
        data-b640-panel={view.kind}
      >
        <span className="grab" aria-hidden="true" />
        <PanelHead
          titleId={titleId}
          conversation={view.kind === 'history' ? null : panelTitle(named ? stage : null)}
          historyPath={pathOf({ kind: 'history' })}
          onHistory={() => onView({ kind: 'history' })}
          onClose={onClose}
        />
        {view.kind === 'dialog' ? (
          <DialogView stage={stage} reviewPath={REVIEW_PATH} tariffsPath={TARIFFS_PATH} />
        ) : null}
        {view.kind === 'history' ? (
          <HistoryView
            conversationPath={(id) => pathOf({ kind: 'conversation', id })}
            onOpen={(id) => onView({ kind: 'conversation', id })}
            onStart={() => onView({ kind: 'dialog' })}
          />
        ) : null}
        {view.kind === 'conversation' ? <ConversationView key={view.id} id={view.id} /> : null}
      </aside>
    </>
  );
}
