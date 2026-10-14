import { useEffect, useState } from 'react';
import { ArrowClockwise, Briefcase, WarningCircle } from '@phosphor-icons/react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationView } from './applicationsApi';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import type { UseApplications } from './useApplications';
import { isResponseNeedingAction } from './responsesFiltering';
import { ResponsesCard } from './ResponsesCard';
import { ManualCardForm } from './ManualCardForm';
import { ArchivedResponsesSection } from './ArchivedResponsesSection';
import { ResponsesWorkspaceScreen } from './ResponsesWorkspace';

interface Column {
  readonly key: string;
  readonly label: string;
  readonly stages: readonly ApplicationStage[];
}

const COLUMNS: readonly Column[] = [
  { key: 'sent', label: 'Отправлено', stages: ['saved', 'applied'] },
  { key: 'responded', label: 'Ответили', stages: ['responded'] },
  { key: 'interview', label: 'Интервью', stages: ['interview'] },
  { key: 'offer', label: 'Оффер', stages: ['offer'] },
];

function useStageFilter(initial?: ApplicationStage) {
  const [stageFilter, setStageFilter] = useState<ApplicationStage | null>(initial ?? null);
  useEffect(() => {
    setStageFilter(initial ?? null);
  }, [initial]);
  return [stageFilter, setStageFilter] as const;
}

/**
 * Канбан «Отклики» (B248 §responses, B251 S3): один экран для всего активного
 * поиска. Восемь состояний интерфейса живут здесь одним компонентом —
 * загрузка/пусто/ошибка идут раньше доски, «частично» и «без прав» — как
 * баннеры поверх карточек, которые всё ещё видны.
 */
export function ResponsesBoard({
  state,
  onOpenVacancies,
  onOpenAutomation,
  initialStageFilter,
  initialArchiveOpen,
  initialTab,
  onOpenExpert,
}: {
  state: UseApplications;
  onOpenVacancies: () => void;
  initialStageFilter?: ApplicationStage;
  initialArchiveOpen?: boolean;
  initialTab?: 'board' | 'analytics';
  onOpenAutomation?: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
}) {
  const [stageFilter, setStageFilter] = useStageFilter(initialStageFilter);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    return (
      <ErrorState message={state.error ?? ''} offline={state.offline} onRetry={state.reload} />
    );
  }

  return (
    <ReadyBoard
      state={state}
      onOpenVacancies={onOpenVacancies}
      onOpenAutomation={onOpenAutomation}
      stageFilter={stageFilter}
      onStageFilterChange={setStageFilter}
      initialArchiveOpen={initialArchiveOpen}
      initialTab={initialTab}
      onClearFilter={() => setStageFilter(null)}
      onOpenExpert={onOpenExpert}
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
        <h3>Откликов пока нет за выбранный период</h3>
        <p>Здесь появится карточка каждого отклика с материалами и следующим шагом.</p>
        <p className="career-responses-empty-step">
          Выберите другой период. Откликнитесь на вакансию из подборки.
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
      <button type="button" className="career-responses-filter-reset" onClick={onClear}>
        Показать все
      </button>
    </div>
  );
}

function BoardColumnsList({
  columns,
  state,
  applications,
  selectedId,
  onSelectApplication,
  visibleCounts,
  onLoadMore,
  onSwitchToTable,
  activeMenuCardId,
  onToggleMenu,
  onCloseMenu,
  onOpenExpert,
}: {
  columns: readonly Column[];
  state: UseApplications;
  applications: readonly ApplicationView[];
  selectedId?: string;
  onSelectApplication: (id: string) => void;
  visibleCounts: Readonly<Record<string, number>>;
  onLoadMore: (column: string) => void;
  onSwitchToTable: () => void;
  activeMenuCardId: string | null;
  onToggleMenu: (cardId: string) => void;
  onCloseMenu: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
}) {
  return (
    <div className="career-responses-board">
      {columns.map((column) => (
        <BoardColumn
          key={column.key}
          column={column}
          state={state}
          applications={applications}
          selectedId={selectedId}
          onSelectApplication={onSelectApplication}
          visibleCount={visibleCounts[column.key] ?? 4}
          onLoadMore={() => onLoadMore(column.key)}
          onSwitchToTable={onSwitchToTable}
          activeMenuCardId={activeMenuCardId}
          onToggleMenu={onToggleMenu}
          onCloseMenu={onCloseMenu}
          onOpenExpert={onOpenExpert}
        />
      ))}
    </div>
  );
}

interface BoardColumnsAndArchiveProps {
  readonly state: UseApplications;
  readonly applications: readonly ApplicationView[];
  readonly visibleColumns: readonly Column[];
  readonly initialArchiveOpen?: boolean;
  readonly selectedId?: string;
  readonly onSelectApplication: (id: string) => void;
  readonly visibleCounts: Readonly<Record<string, number>>;
  readonly onLoadMore: (column: string) => void;
  readonly onSwitchToTable: () => void;
  readonly activeMenuCardId: string | null;
  readonly onToggleMenu: (id: string) => void;
  readonly onCloseMenu: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}

function BoardColumnsAndArchive({
  state,
  applications,
  visibleColumns,
  initialArchiveOpen,
  selectedId,
  onSelectApplication,
  visibleCounts,
  onLoadMore,
  onSwitchToTable,
  activeMenuCardId,
  onToggleMenu,
  onCloseMenu,
  onOpenExpert,
}: BoardColumnsAndArchiveProps) {
  return (
    <>
      <BoardColumnsList
        columns={visibleColumns}
        state={state}
        applications={applications}
        selectedId={selectedId}
        onSelectApplication={onSelectApplication}
        visibleCounts={visibleCounts}
        onLoadMore={onLoadMore}
        onSwitchToTable={onSwitchToTable}
        activeMenuCardId={activeMenuCardId}
        onToggleMenu={onToggleMenu}
        onCloseMenu={onCloseMenu}
        onOpenExpert={onOpenExpert}
      />
      <ArchivedResponsesSection
        applications={state.applications.filter((a) => a.stage === 'archived')}
        initiallyOpen={initialArchiveOpen}
        onRestore={state.restoreFromArchive}
      />
    </>
  );
}

type BoardTabContentProps = Omit<
  BoardColumnsAndArchiveProps,
  'activeMenuCardId' | 'onToggleMenu' | 'onCloseMenu'
> & {
  readonly stageFilter?: ApplicationStage | null;
  readonly onClearFilter?: () => void;
};

function BoardTabContent(props: BoardTabContentProps) {
  const [activeMenuCardId, setActiveMenuCardId] = useState<string | null>(null);
  return (
    <BoardTabColumnsContent
      props={props}
      activeMenuCardId={activeMenuCardId}
      onToggleMenu={(id) => setActiveMenuCardId((current) => (current === id ? null : id))}
      onCloseMenu={() => setActiveMenuCardId(null)}
    />
  );
}

function BoardTabColumnsContent({
  props,
  activeMenuCardId,
  onToggleMenu,
  onCloseMenu,
}: {
  readonly props: BoardTabContentProps;
  readonly activeMenuCardId: string | null;
  readonly onToggleMenu: (id: string) => void;
  readonly onCloseMenu: () => void;
}) {
  return (
    <>
      {props.stageFilter === 'interview' && props.onClearFilter ? (
        <FilterNotice onClear={props.onClearFilter} />
      ) : null}
      <BoardColumnsAndArchive
        state={props.state}
        applications={props.applications}
        visibleColumns={props.visibleColumns}
        initialArchiveOpen={props.initialArchiveOpen}
        selectedId={props.selectedId}
        onSelectApplication={props.onSelectApplication}
        visibleCounts={props.visibleCounts}
        onLoadMore={props.onLoadMore}
        onSwitchToTable={props.onSwitchToTable}
        activeMenuCardId={activeMenuCardId}
        onToggleMenu={onToggleMenu}
        onCloseMenu={onCloseMenu}
        onOpenExpert={props.onOpenExpert}
      />
    </>
  );
}

function ReadyBoard({
  state,
  onOpenVacancies,
  onOpenAutomation,
  stageFilter,
  onStageFilterChange,
  initialArchiveOpen,
  initialTab,
  onClearFilter,
  onOpenExpert,
}: {
  state: UseApplications;
  onOpenVacancies: () => void;
  onOpenAutomation?: () => void;
  stageFilter?: ApplicationStage | null;
  onStageFilterChange: (stage: ApplicationStage | null) => void;
  initialArchiveOpen?: boolean;
  initialTab?: 'board' | 'analytics';
  onClearFilter?: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
}) {
  return (
    <ResponsesWorkspaceScreen
      state={state}
      stageFilter={stageFilter}
      onStageFilterChange={onStageFilterChange}
      onClearFilter={onClearFilter}
      onOpenVacancies={onOpenVacancies}
      onOpenAutomation={onOpenAutomation}
      onOpenExpert={onOpenExpert}
      initialTab={initialTab}
      columnsContent={(input) => (
        <BoardColumnsView
          {...input}
          state={state}
          stageFilter={stageFilter}
          initialArchiveOpen={initialArchiveOpen}
          onOpenExpert={onOpenExpert}
        />
      )}
      emptyContent={
        <ReadyBoardEmptyContent
          state={state}
          onOpenVacancies={onOpenVacancies}
          initialArchiveOpen={initialArchiveOpen}
        />
      }
    />
  );
}

function ReadyBoardEmptyContent({
  state,
  onOpenVacancies,
  initialArchiveOpen,
}: {
  readonly state: UseApplications;
  readonly onOpenVacancies: () => void;
  readonly initialArchiveOpen?: boolean;
}) {
  return (
    <>
      <EmptyState state={state} onOpenVacancies={onOpenVacancies} />
      <ArchivedResponsesSection
        applications={state.applications.filter((application) => application.stage === 'archived')}
        initiallyOpen={initialArchiveOpen}
        onRestore={state.restoreFromArchive}
      />
    </>
  );
}

function BoardColumnsView({
  applications,
  selectedId,
  onSelectApplication,
  visibleCounts,
  onLoadMore,
  onSwitchToTable,
  state,
  stageFilter,
  initialArchiveOpen,
  onClearFilter,
  onOpenExpert,
}: {
  readonly applications: readonly ApplicationView[];
  readonly selectedId?: string;
  readonly onSelectApplication: (id: string) => void;
  readonly visibleCounts: Readonly<Record<string, number>>;
  readonly onLoadMore: (column: string) => void;
  readonly onSwitchToTable: () => void;
  readonly state: UseApplications;
  readonly stageFilter?: ApplicationStage | null;
  readonly initialArchiveOpen?: boolean;
  readonly onClearFilter: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}) {
  const visibleColumns = stageFilter
    ? COLUMNS.filter((column) => column.stages.includes(stageFilter))
    : COLUMNS;
  return (
    <BoardTabContent
      state={state}
      applications={applications}
      visibleColumns={visibleColumns}
      initialArchiveOpen={initialArchiveOpen}
      selectedId={selectedId}
      onSelectApplication={onSelectApplication}
      visibleCounts={visibleCounts}
      onLoadMore={onLoadMore}
      onSwitchToTable={onSwitchToTable}
      stageFilter={stageFilter}
      onClearFilter={onClearFilter}
      onOpenExpert={onOpenExpert}
    />
  );
}

interface BoardColumnProps {
  column: Column;
  state: UseApplications;
  applications: readonly ApplicationView[];
  selectedId?: string;
  onSelectApplication: (id: string) => void;
  visibleCount: number;
  onLoadMore: () => void;
  onSwitchToTable: () => void;
  activeMenuCardId: string | null;
  onToggleMenu: (cardId: string) => void;
  onCloseMenu: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
}

function ColumnHeader({
  label,
  count,
  needsActionCount,
}: {
  label: string;
  count: number;
  needsActionCount: number;
}) {
  return (
    <header className="career-responses-column-head">
      <div>
        <h2>{label}</h2>
        <span className="career-responses-column-count">{count.toLocaleString('ru-RU')}</span>
      </div>
      <p>Нужно действие: {needsActionCount.toLocaleString('ru-RU')}</p>
    </header>
  );
}

function ColumnCardItem({
  application,
  state,
  selected,
  onSelectApplication,
  isMenuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpenExpert,
}: {
  application: ApplicationView;
  state: UseApplications;
  selected: boolean;
  onSelectApplication: (id: string) => void;
  isMenuOpen: boolean;
  onToggleMenu: (id: string) => void;
  onCloseMenu: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
}) {
  return (
    <ResponsesCard
      application={application}
      selected={selected}
      onSelect={() => onSelectApplication(application.id)}
      failed={state.failedChanges.has(application.id)}
      conflicted={state.conflicts.has(application.id)}
      isMenuOpen={isMenuOpen}
      onToggleMenu={() => onToggleMenu(application.id)}
      onCloseMenu={onCloseMenu}
      onOpenExpert={onOpenExpert}
      onChangeStage={(stage, occurredAt, receipt) =>
        state.changeStage(application.id, stage, occurredAt, receipt)
      }
      onScheduleInterview={(scheduledAt) => state.scheduleInterview(application.id, scheduledAt)}
      onRetry={() => state.retryStageChange(application.id)}
      onRefresh={state.reload}
      onSaveNote={(notes) => state.saveNote(application.id, notes)}
      onSkip={(reasonId) => void state.skip(application, reasonId)}
    />
  );
}

function BoardColumn({
  column,
  state,
  applications,
  selectedId,
  onSelectApplication,
  visibleCount,
  onLoadMore,
  onSwitchToTable,
  activeMenuCardId,
  onToggleMenu,
  onCloseMenu,
  onOpenExpert,
}: BoardColumnProps) {
  const allCards = applicationsForColumn(applications, column);
  const cards = allCards.slice(0, visibleCount);
  const needsActionCount = allCards.filter(isResponseNeedingAction).length;
  return (
    <section
      className={`career-responses-column${allCards.length === 0 ? ' is-empty' : ''}`}
      aria-label={column.label}
    >
      <ColumnHeader
        label={column.label}
        count={allCards.length}
        needsActionCount={needsActionCount}
      />
      <BoardColumnContent
        column={column}
        state={state}
        cards={cards}
        totalCount={allCards.length}
        selectedId={selectedId}
        onSelectApplication={onSelectApplication}
        onLoadMore={onLoadMore}
        onSwitchToTable={onSwitchToTable}
        activeMenuCardId={activeMenuCardId}
        onToggleMenu={onToggleMenu}
        onCloseMenu={onCloseMenu}
        onOpenExpert={onOpenExpert}
      />
    </section>
  );
}

interface BoardColumnContentProps {
  readonly column: Column;
  readonly state: UseApplications;
  readonly cards: readonly ApplicationView[];
  readonly totalCount: number;
  readonly selectedId?: string;
  readonly onSelectApplication: (id: string) => void;
  readonly onLoadMore: () => void;
  readonly onSwitchToTable: () => void;
  readonly activeMenuCardId: string | null;
  readonly onToggleMenu: (id: string) => void;
  readonly onCloseMenu: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}

function BoardColumnContent({
  column,
  state,
  cards,
  totalCount,
  selectedId,
  onSelectApplication,
  onLoadMore,
  onSwitchToTable,
  activeMenuCardId,
  onToggleMenu,
  onCloseMenu,
  onOpenExpert,
}: BoardColumnContentProps) {
  return (
    <div className="career-responses-column-body">
      {cards.map((application) => (
        <ColumnCardItem
          key={application.id}
          application={application}
          state={state}
          selected={selectedId === application.id}
          onSelectApplication={onSelectApplication}
          isMenuOpen={activeMenuCardId === application.id}
          onToggleMenu={onToggleMenu}
          onCloseMenu={onCloseMenu}
          onOpenExpert={onOpenExpert}
        />
      ))}
      {totalCount > cards.length ? (
        <button type="button" className="career-responses-column-more" onClick={onLoadMore}>
          Показать ещё 20
        </button>
      ) : null}
      {column.key === 'offer' && totalCount === 0 ? <OfferPlaceholder /> : null}
      <ColumnFooter shown={cards.length} total={totalCount} onSwitchToTable={onSwitchToTable} />
    </div>
  );
}

function ColumnFooter({
  shown,
  total,
  onSwitchToTable,
}: {
  readonly shown: number;
  readonly total: number;
  readonly onSwitchToTable: () => void;
}) {
  return (
    <footer className="career-responses-column-footer">
      <span>
        Показано {shown.toLocaleString('ru-RU')} из {total.toLocaleString('ru-RU')}
      </span>
      <button type="button" onClick={onSwitchToTable}>
        В таблицу
      </button>
    </footer>
  );
}

function applicationsForColumn(
  applications: readonly ApplicationView[],
  column: Column,
): readonly ApplicationView[] {
  return applications.filter((application) => column.stages.includes(application.stage));
}

function OfferPlaceholder() {
  return (
    <div className="career-responses-offer-placeholder">
      Пока пусто. Здесь появится оффер, когда компания его пришлёт — с дедлайном ответа.
    </div>
  );
}
