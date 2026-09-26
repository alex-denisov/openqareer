import { useState } from 'react';
import { ArrowClockwise, Briefcase, DotsThreeVertical, WarningCircle } from '@phosphor-icons/react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { UseApplications } from './useApplications';
import { ResponsesCard } from './ResponsesCard';
import { ManualCardForm } from './ManualCardForm';

interface Column {
  readonly key: string;
  readonly label: string;
  readonly stages: readonly ApplicationStage[];
}

const COLUMNS: readonly Column[] = [
  { key: 'saved', label: 'Хочу', stages: ['saved'] },
  { key: 'applied', label: 'Откликнулся', stages: ['applied'] },
  { key: 'responded', label: 'Ответ', stages: ['responded'] },
  { key: 'interview', label: 'Интервью', stages: ['interview'] },
  { key: 'offer', label: 'Оффер', stages: ['offer'] },
  { key: 'closed', label: 'Отказ / Архив', stages: ['rejected', 'archived'] },
];

/**
 * Канбан «Отклики» (B248 §responses, B251 S3): один экран для всего активного
 * поиска. Восемь состояний интерфейса живут здесь одним компонентом —
 * загрузка/пусто/ошибка идут раньше доски, «частично» и «без прав» — как
 * баннеры поверх карточек, которые всё ещё видны.
 */
export function ResponsesBoard({
  state,
  onOpenVacancies,
}: {
  state: UseApplications;
  onOpenVacancies: () => void;
}) {
  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    return <ErrorState message={state.error ?? ''} offline={state.offline} onRetry={state.reload} />;
  }
  if (state.applications.length === 0) return <EmptyState />;
  return <ReadyBoard state={state} onOpenVacancies={onOpenVacancies} />;
}

function LoadingState() {
  return (
    <div className="career-responses-skeleton" aria-busy="true" aria-label="Загружаем отклики">
      <span className="career-skeleton-line is-wide" />
      <span className="career-skeleton-line" />
      <span className="career-skeleton-line is-short" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="career-responses-empty">
      <h3>Пайплайн пуст</h3>
      <p>
        Откликов ещё нет. Пайплайн наполняется из очереди дня — как только вы откликнетесь на первую
        вакансию, здесь появится карточка с материалами и следующим шагом.
      </p>
    </div>
  );
}

function ErrorState({
  message,
  offline,
  onRetry,
}: {
  message: string;
  offline: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="career-expert-error" role="alert">
      <WarningCircle size={16} weight="fill" />
      <p>{offline ? 'Нет соединения. Проверьте сеть и повторите.' : message}</p>
      <button type="button" onClick={onRetry}>
        <ArrowClockwise size={14} /> Повторить
      </button>
    </div>
  );
}

function ReadyBoard({
  state,
  onOpenVacancies,
}: {
  state: UseApplications;
  onOpenVacancies: () => void;
}) {
  const [addingManual, setAddingManual] = useState(false);
  return (
    <div className="career-responses-board-wrap">
      <Legend />
      <div className="career-responses-board">
        {COLUMNS.map((column) => (
          <BoardColumn
            key={column.key}
            column={column}
            state={state}
            onOpenVacancies={column.key === 'saved' ? onOpenVacancies : undefined}
            onAddManual={column.key === 'saved' ? () => setAddingManual(true) : undefined}
          />
        ))}
      </div>
      {addingManual ? (
        <ManualCardForm
          onCancel={() => setAddingManual(false)}
          onSubmit={async (input) => {
            await state.addManualCard(input);
            setAddingManual(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Legend() {
  return (
    <div className="career-responses-legend">
      <span className="is-on-you">ждём вашего действия</span>
      <span className="is-on-them">ждём ответа компании</span>
      <span>материалы на карточке</span>
    </div>
  );
}

function BoardColumn({
  column,
  state,
  onOpenVacancies,
  onAddManual,
}: {
  column: Column;
  state: UseApplications;
  onOpenVacancies?: () => void;
  onAddManual?: () => void;
}) {
  const cards = state.applications.filter((application) => column.stages.includes(application.stage));
  return (
    <section className="career-responses-column" aria-label={column.label}>
      <header className="career-responses-column-head">
        <h2>{column.label}</h2>
        <span className="career-responses-column-count">{cards.length}</span>
      </header>
      <div className="career-responses-column-body">
        {cards.map((application) => (
          <ResponsesCard
            key={application.id}
            application={application}
            failed={state.failedChanges.has(application.id)}
            conflicted={state.conflicts.has(application.id)}
            onChangeStage={(stage, occurredAt) => state.changeStage(application.id, stage, occurredAt)}
            onRetry={() => state.retryStageChange(application.id)}
            onSaveNote={(notes) => state.saveNote(application.id, notes)}
            onMarkFollowUpSent={() => state.markFollowUpSent(application.id)}
            onSkip={(reasonId) => void state.skip(application, reasonId)}
          />
        ))}
        {column.key === 'offer' && cards.length === 0 ? <OfferPlaceholder /> : null}
        {onOpenVacancies ? (
          <AddCardControl onOpenVacancies={onOpenVacancies} onAddManual={onAddManual} />
        ) : null}
      </div>
    </section>
  );
}

function OfferPlaceholder() {
  return (
    <div className="career-responses-offer-placeholder">
      Пока пусто. Здесь появится оффер, когда компания его пришлёт — с дедлайном ответа.
    </div>
  );
}

function AddCardControl({
  onOpenVacancies,
  onAddManual,
}: {
  onOpenVacancies: () => void;
  onAddManual?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="career-responses-add-card-row">
      <button type="button" className="career-responses-add-card" onClick={onOpenVacancies}>
        <Briefcase size={14} /> Добавить из «Вакансии»
      </button>
      {onAddManual ? (
        <div className="career-responses-menu-wrap">
          <button
            type="button"
            aria-label="Ещё способы добавить карточку"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <DotsThreeVertical size={16} />
          </button>
          {menuOpen ? (
            <div className="career-responses-card-menu">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onAddManual();
                }}
              >
                Добавить вручную
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
