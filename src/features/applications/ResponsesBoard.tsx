import { useEffect, useState } from 'react';
import { ArrowClockwise, Briefcase, DotsThreeVertical, WarningCircle } from '@phosphor-icons/react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationView } from './applicationsApi';
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
  initialStageFilter,
}: {
  state: UseApplications;
  onOpenVacancies: () => void;
  initialStageFilter?: ApplicationStage;
}) {
  const [stageFilter, setStageFilter] = useState<ApplicationStage | null>(
    initialStageFilter ?? null,
  );

  useEffect(() => {
    setStageFilter(initialStageFilter ?? null);
  }, [initialStageFilter]);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    return (
      <ErrorState message={state.error ?? ''} offline={state.offline} onRetry={state.reload} />
    );
  }

  const interviewApplications = state.applications.filter(
    (app) => app.stage === 'interview',
  );

  if (stageFilter === 'interview' && interviewApplications.length === 0) {
    return <InterviewEmptyState onClear={() => setStageFilter(null)} />;
  }

  if (state.applications.length === 0) {
    return <EmptyState state={state} onOpenVacancies={onOpenVacancies} />;
  }

  return (
    <ReadyBoard
      state={state}
      onOpenVacancies={onOpenVacancies}
      stageFilter={stageFilter}
      onClearFilter={() => setStageFilter(null)}
    />
  );
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

function EmptyState({
  state,
  onOpenVacancies,
}: {
  state: UseApplications;
  onOpenVacancies: () => void;
}) {
  const [addingManual, setAddingManual] = useState(false);
  return (
    <>
      <div className="career-responses-empty">
        <h3>Откликов пока нет</h3>
        <p>
          Здесь появится карточка каждого отклика с материалами и следующим шагом.
        </p>
        <p className="career-responses-empty-step">
          Откликнитесь на вакансию из подборки, чтобы начать.
        </p>
        <div className="career-responses-empty-actions">
          <button
            type="button"
            className="career-btn career-btn-primary career-btn-sm"
            onClick={onOpenVacancies}
          >
            <Briefcase size={14} /> Перейти к вакансиям
          </button>
          <button
            type="button"
            className="career-btn career-btn-secondary career-btn-sm"
            onClick={() => setAddingManual(true)}
          >
            Добавить отклик вручную
          </button>
        </div>
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
    </>
  );
}

function InterviewEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="career-responses-empty" role="status">
      <h3>Интервью пока не назначены</h3>
      <div className="career-responses-empty-actions">
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          onClick={onClear}
        >
          Открыть все отклики
        </button>
      </div>
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

function FilterNotice({ onClear }: { onClear: () => void }) {
  return (
    <div className="career-responses-filter-notice" role="status">
      <span>Показаны отклики на этапе «Интервью»</span>
      <span className="career-responses-filter-notice-sep">·</span>
      <button
        type="button"
        className="career-responses-filter-reset"
        onClick={onClear}
      >
        Показать все
      </button>
    </div>
  );
}

function BoardColumnsList({
  columns,
  state,
  activeMenuCardId,
  onToggleMenu,
  onCloseMenu,
  onOpenVacancies,
  onAddManual,
}: {
  columns: readonly Column[];
  state: UseApplications;
  activeMenuCardId: string | null;
  onToggleMenu: (cardId: string) => void;
  onCloseMenu: () => void;
  onOpenVacancies: () => void;
  onAddManual: () => void;
}) {
  return (
    <div className="career-responses-board">
      {columns.map((column) => (
        <BoardColumn
          key={column.key}
          column={column}
          state={state}
          activeMenuCardId={activeMenuCardId}
          onToggleMenu={onToggleMenu}
          onCloseMenu={onCloseMenu}
          onOpenVacancies={column.key === 'saved' ? onOpenVacancies : undefined}
          onAddManual={column.key === 'saved' ? onAddManual : undefined}
        />
      ))}
    </div>
  );
}

function ReadyBoard({
  state,
  onOpenVacancies,
  stageFilter,
  onClearFilter,
}: {
  state: UseApplications;
  onOpenVacancies: () => void;
  stageFilter?: ApplicationStage | null;
  onClearFilter?: () => void;
}) {
  const [addingManual, setAddingManual] = useState(false);
  const [activeMenuCardId, setActiveMenuCardId] = useState<string | null>(null);

  const visibleColumns = stageFilter
    ? COLUMNS.filter((column) => column.stages.includes(stageFilter))
    : COLUMNS;

  return (
    <div className="career-responses-board-wrap">
      {stageFilter === 'interview' && onClearFilter ? (
        <FilterNotice onClear={onClearFilter} />
      ) : null}
      <Legend />
      <BoardColumnsList
        columns={visibleColumns}
        state={state}
        activeMenuCardId={activeMenuCardId}
        onToggleMenu={(id) => setActiveMenuCardId((cur) => (cur === id ? null : id))}
        onCloseMenu={() => setActiveMenuCardId(null)}
        onOpenVacancies={onOpenVacancies}
        onAddManual={() => setAddingManual(true)}
      />
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

interface BoardColumnProps {
  column: Column;
  state: UseApplications;
  activeMenuCardId: string | null;
  onToggleMenu: (cardId: string) => void;
  onCloseMenu: () => void;
  onOpenVacancies?: () => void;
  onAddManual?: () => void;
}

function ColumnHeader({ label, count }: { label: string; count: number }) {
  return (
    <header className="career-responses-column-head">
      <h2>{label}</h2>
      <span className="career-responses-column-count">{count}</span>
    </header>
  );
}

function ColumnCardItem({
  application,
  state,
  isMenuOpen,
  onToggleMenu,
  onCloseMenu,
}: {
  application: ApplicationView;
  state: UseApplications;
  isMenuOpen: boolean;
  onToggleMenu: (id: string) => void;
  onCloseMenu: () => void;
}) {
  return (
    <ResponsesCard
      application={application}
      failed={state.failedChanges.has(application.id)}
      conflicted={state.conflicts.has(application.id)}
      isMenuOpen={isMenuOpen}
      onToggleMenu={() => onToggleMenu(application.id)}
      onCloseMenu={onCloseMenu}
      onChangeStage={(stage, occurredAt) =>
        state.changeStage(application.id, stage, occurredAt)
      }
      onScheduleInterview={(scheduledAt) =>
        state.scheduleInterview(application.id, scheduledAt)
      }
      onRetry={() => state.retryStageChange(application.id)}
      onRefresh={state.reload}
      onSaveNote={(notes) => state.saveNote(application.id, notes)}
      onMarkFollowUpSent={() => state.markFollowUpSent(application.id)}
      onSkip={(reasonId) => void state.skip(application, reasonId)}
    />
  );
}

function BoardColumn({
  column,
  state,
  activeMenuCardId,
  onToggleMenu,
  onCloseMenu,
  onOpenVacancies,
  onAddManual,
}: BoardColumnProps) {
  const cards = state.applications.filter((application) =>
    column.stages.includes(application.stage),
  );
  return (
    <section className="career-responses-column" aria-label={column.label}>
      <ColumnHeader label={column.label} count={cards.length} />
      <div className="career-responses-column-body">
        {cards.map((application) => (
          <ColumnCardItem
            key={application.id}
            application={application}
            state={state}
            isMenuOpen={activeMenuCardId === application.id}
            onToggleMenu={onToggleMenu}
            onCloseMenu={onCloseMenu}
          />
        ))}
        {column.key === 'offer' && cards.length === 0 ? <OfferPlaceholder /> : null}
        {onOpenVacancies ? (
          <AddCardControl
            menuOpen={activeMenuCardId === 'add-manual'}
            onToggleMenu={() => onToggleMenu('add-manual')}
            onCloseMenu={onCloseMenu}
            onOpenVacancies={onOpenVacancies}
            onAddManual={onAddManual}
          />
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
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpenVacancies,
  onAddManual,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onOpenVacancies: () => void;
  onAddManual?: () => void;
}) {
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
            onClick={onToggleMenu}
          >
            <DotsThreeVertical size={18} />
          </button>
          {menuOpen ? (
            <div className="career-responses-card-menu">
              <button
                type="button"
                onClick={() => {
                  onCloseMenu();
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
