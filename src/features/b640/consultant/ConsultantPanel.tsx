import { useCallback, useEffect, useId, useState } from 'react';
import type { CoachTurnStage, CoachTurnSubject } from '../../coach/coachApi';
import { Icon } from '../kit/Icon';
import { hasOpenModal } from '../kit/useModalFocus';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { closeCurrentConversation } from './consultantApi';
import { DialogView } from './DialogView';
import { ConversationView, HistoryView } from './HistoryView';
import { ReviewView } from './ReviewView';
import { panelTitle } from './model';
import { ErrorRow } from './parts';
import type { PanelView } from './panelRoute';

export type { PanelView };

export interface ConsultantPanelProps {
  readonly view: PanelView;
  /** Тема разговора: раздел, над которым открыта панель. */
  readonly stage: CoachTurnStage;
  /** B746: объект экрана под панелью (отклик, вакансия); нет — вопрос по разделу. */
  readonly subject?: CoachTurnSubject;
  /** Раздел под панелью назван в заголовке; `false` — панель открыта сама по себе. */
  readonly named: boolean;
  /** Адрес вида панели: ссылка открывается и в новой вкладке. */
  readonly pathOf: (view: PanelView) => string;
  readonly onView: (view: PanelView) => void;
  readonly onClose: () => void;
}

const TARIFFS_PATH = buildNodePath('t01');

interface PanelBack {
  readonly label: string;
  readonly path: string;
  readonly onOpen: () => void;
}

interface PanelHeadProps {
  readonly titleId: string;
  /** Заголовок разговора; `null` — открыт список разговоров. */
  readonly conversation: string | null;
  /** Куда ведёт «‹»: из записей на проверку — к разговору, иначе — ко всем разговорам. */
  readonly back: PanelBack;
  /** «Новый разговор»; нет — кнопки нет (открыт прошлый разговор). */
  readonly onNew?: () => void;
  readonly newBusy: boolean;
  readonly onClose: () => void;
}

function NewButton({ onNew, busy }: { readonly onNew: () => void; readonly busy: boolean }) {
  return (
    <button
      className="btn is-quiet is-sm ph-new"
      type="button"
      aria-label="Новый разговор"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={onNew}
    >
      <Icon name="plus" />
      <span className="ph-new-l" aria-hidden="true">
        Новый разговор
      </span>
    </button>
  );
}

function PanelHead({ titleId, conversation, back, onNew, newBusy, onClose }: PanelHeadProps) {
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
            to={back.path}
            aria-label={back.label}
            onClick={(event) => {
              event.preventDefault();
              back.onOpen();
            }}
          >
            <Icon name="left" />
            <span className="ph-back-l">{back.label}</span>
          </Link>
          <h2 className="ph-title ph-conv" id={titleId}>
            {conversation}
          </h2>
        </>
      )}
      <div className="head-acts">
        {onNew ? <NewButton onNew={onNew} busy={newBusy} /> : null}
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

interface FreshDialog {
  /** Ключ ленты: меняется, когда начат новый или продолжен прошлый разговор. */
  readonly key: number;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly startNew: () => void;
  readonly reopen: () => void;
}

/** «Новый разговор» и переход к продолжённому: лента читается заново. */
function useFreshDialog(onDialog: () => void): FreshDialog {
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const reopen = useCallback(() => {
    setKey((value) => value + 1);
    onDialog();
  }, [onDialog]);
  const startNew = useCallback(() => {
    setBusy(true);
    setFailed(false);
    closeCurrentConversation()
      .then(reopen)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  }, [reopen]);
  return { key, busy, failed, startNew, reopen };
}

function headTitle(view: PanelView, stage: CoachTurnStage | null): string | null {
  if (view.kind === 'history') return null;
  return view.kind === 'review' ? 'Записи на проверку' : panelTitle(stage);
}

function backOf(
  view: PanelView,
  pathOf: (view: PanelView) => string,
  onView: (view: PanelView) => void,
): PanelBack {
  if (view.kind === 'review') {
    return {
      label: 'К разговору',
      path: pathOf({ kind: 'dialog' }),
      onOpen: () => onView({ kind: 'dialog' }),
    };
  }
  return {
    label: 'Все разговоры',
    path: pathOf({ kind: 'history' }),
    onOpen: () => onView({ kind: 'history' }),
  };
}

interface PanelBodyProps {
  readonly view: PanelView;
  readonly stage: CoachTurnStage;
  readonly subject?: CoachTurnSubject;
  readonly freshKey: number;
  readonly pathOf: (view: PanelView) => string;
  readonly onView: (view: PanelView) => void;
  readonly onContinued: () => void;
}

function PanelBody({
  view,
  stage,
  subject,
  freshKey,
  pathOf,
  onView,
  onContinued,
}: PanelBodyProps) {
  if (view.kind === 'review') return <ReviewView />;
  if (view.kind === 'conversation') {
    return <ConversationView key={view.id} id={view.id} onContinued={onContinued} />;
  }
  if (view.kind === 'history') {
    return (
      <HistoryView
        conversationPath={(id) => pathOf({ kind: 'conversation', id })}
        onOpen={(id) => onView({ kind: 'conversation', id })}
        onStart={() => onView({ kind: 'dialog' })}
      />
    );
  }
  return (
    <DialogView
      key={freshKey}
      stage={stage}
      subject={subject}
      reviewPath={pathOf({ kind: 'review' })}
      onReview={() => onView({ kind: 'review' })}
      tariffsPath={TARIFFS_PATH}
    />
  );
}

/**
 * Панель консультанта (макеты K1–K7): на 1440 и 1176 — третья колонка сетки `.app.has-panel`,
 * на 390 — лист снизу. Ставится соседом `main` внутри `.app`.
 */
export function ConsultantPanel({
  view,
  stage,
  subject,
  named,
  pathOf,
  onView,
  onClose,
}: ConsultantPanelProps) {
  const titleId = useId();
  useEscape(onClose);
  const showDialog = useCallback(() => onView({ kind: 'dialog' }), [onView]);
  const fresh = useFreshDialog(showDialog);
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
          conversation={headTitle(view, named ? stage : null)}
          back={backOf(view, pathOf, onView)}
          onNew={view.kind === 'dialog' || view.kind === 'history' ? fresh.startNew : undefined}
          newBusy={fresh.busy}
          onClose={onClose}
        />
        {fresh.failed ? (
          <ErrorRow text="Новый разговор не начался" onRetry={fresh.startNew} />
        ) : null}
        <PanelBody
          view={view}
          stage={stage}
          subject={subject}
          freshKey={fresh.key}
          pathOf={pathOf}
          onView={onView}
          onContinued={fresh.reopen}
        />
      </aside>
    </>
  );
}
