import { useEffect, useState } from 'react';
import {
  ArrowClockwise,
  Briefcase,
  ChartBar,
  DotsThreeVertical,
  Kanban,
  Scales,
  WarningCircle,
} from '@phosphor-icons/react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import { deliveryState } from '../../../shared/applicationStage';
import type { ApplicationView } from './applicationsApi';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import type { UseApplications } from './useApplications';
import { ResponsesCard } from './ResponsesCard';
import { ManualCardForm } from './ManualCardForm';
import { ArchivedResponsesSection } from './ArchivedResponsesSection';
import { PipelineAnalyticsView } from './PipelineAnalyticsView';
import { OfferComparisonMatrix } from './OfferComparisonMatrix';
import { OfferEditModal } from './OfferEditModal';
import { CandidateActionPanel } from './CandidateActionPanel';

interface Column {
  readonly key: string;
  readonly label: string;
  readonly stages: readonly ApplicationStage[];
}

const COLUMNS: readonly Column[] = [
  { key: 'saved', label: 'Хочу', stages: ['saved'] },
  { key: 'attempted', label: 'Пробовали отправить', stages: ['applied'] },
  { key: 'delivered', label: 'Отправлено', stages: ['applied'] },
  { key: 'responded', label: 'Ответ', stages: ['responded'] },
  { key: 'interview', label: 'Интервью', stages: ['interview'] },
  { key: 'offer', label: 'Оффер', stages: ['offer'] },
  { key: 'closed', label: 'Отказ', stages: ['rejected'] },
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
  initialArchiveOpen,
  initialTab,
  onOpenExpert,
}: {
  state: UseApplications;
  onOpenVacancies: () => void;
  initialStageFilter?: ApplicationStage;
  initialArchiveOpen?: boolean;
  initialTab?: 'board' | 'analytics';
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
}) {
  const [tab, setTab] = useState<'board' | 'analytics'>(initialTab ?? 'board');
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

  const interviewApplications = state.applications.filter((app) => app.stage === 'interview');

  if (stageFilter === 'interview' && interviewApplications.length === 0) {
    return <InterviewEmptyState onClear={() => setStageFilter(null)} />;
  }

  if (state.applications.length === 0 && tab === 'board') {
    return (
      <>
        <CandidateActionPanel
          applications={state.applications}
          onRefreshApplications={state.refreshApplications}
        />
        <EmptyState state={state} onOpenVacancies={onOpenVacancies} />
      </>
    );
  }

  return (
    <ReadyBoard
      state={state}
      onOpenVacancies={onOpenVacancies}
      stageFilter={stageFilter}
      initialArchiveOpen={initialArchiveOpen}
      activeTab={tab}
      onChangeTab={setTab}
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
        <h3>Откликов пока нет</h3>
        <p>Здесь появится карточка каждого отклика с материалами и следующим шагом.</p>
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
      <button type="button" className="career-responses-filter-reset" onClick={onClear}>
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
  onOpenExpert,
  onOpenCompareOffers,
  onOpenOfferEdit,
}: {
  columns: readonly Column[];
  state: UseApplications;
  activeMenuCardId: string | null;
  onToggleMenu: (cardId: string) => void;
  onCloseMenu: () => void;
  onOpenVacancies: () => void;
  onAddManual: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
  onOpenCompareOffers?: () => void;
  onOpenOfferEdit?: (applicationId: string) => void;
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
          onOpenExpert={onOpenExpert}
          onOpenCompareOffers={onOpenCompareOffers}
          onOpenOfferEdit={onOpenOfferEdit}
        />
      ))}
    </div>
  );
}

function BoardModals({
  state,
  modals,
}: {
  readonly state: UseApplications;
  readonly modals: ReturnType<typeof useBoardModals>;
}) {
  const editingOfferApp = modals.editingOfferId
    ? (state.applications.find((application) => application.id === modals.editingOfferId) ?? null)
    : null;

  return (
    <>
      {modals.addingManual ? (
        <ManualCardFormDialog state={state} onCancel={modals.closeManual} />
      ) : null}
      {modals.comparingOffers ? (
        <OfferComparisonMatrix
          applications={state.applications.filter(
            (application) => application.stage === 'offer' || application.offer !== null,
          )}
          onClose={modals.closeCompare}
          onEditOffer={modals.openEditOffer}
        />
      ) : null}
      {editingOfferApp ? (
        <OfferEditModal
          application={editingOfferApp}
          isOpen={true}
          onClose={modals.closeEditOffer}
          onSave={state.saveOffer}
        />
      ) : null}
    </>
  );
}

function useBoardModals() {
  const [addingManual, setAddingManual] = useState(false);
  const [comparingOffers, setComparingOffers] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);

  return {
    addingManual,
    comparingOffers,
    editingOfferId,
    openManual: () => setAddingManual(true),
    closeManual: () => setAddingManual(false),
    openCompare: () => setComparingOffers(true),
    closeCompare: () => setComparingOffers(false),
    openEditOffer: (id: string) => setEditingOfferId(id),
    closeEditOffer: () => setEditingOfferId(null),
  };
}

function ResponsesViewSwitch({
  tab,
  onChange,
}: {
  readonly tab: 'board' | 'analytics';
  readonly onChange: (tab: 'board' | 'analytics') => void;
}) {
  return (
    <div className="view-switch" role="tablist" aria-label="Режим отображения откликов">
      <button
        type="button"
        role="tab"
        className={tab === 'board' ? 'is-active' : ''}
        aria-selected={tab === 'board'}
        onClick={() => onChange('board')}
      >
        <Kanban size={16} aria-hidden="true" />
        <span>Доска</span>
      </button>
      <button
        type="button"
        role="tab"
        className={tab === 'analytics' ? 'is-active' : ''}
        aria-selected={tab === 'analytics'}
        onClick={() => onChange('analytics')}
      >
        <ChartBar size={16} aria-hidden="true" />
        <span>Аналитика воронки</span>
      </button>
    </div>
  );
}

function BoardColumnsAndArchive({
  state,
  visibleColumns,
  initialArchiveOpen,
  activeMenuCardId,
  onToggleMenu,
  onCloseMenu,
  onOpenVacancies,
  onAddManual,
  onOpenExpert,
  onOpenCompareOffers,
  onOpenOfferEdit,
}: {
  readonly state: UseApplications;
  readonly visibleColumns: readonly Column[];
  readonly initialArchiveOpen?: boolean;
  readonly activeMenuCardId: string | null;
  readonly onToggleMenu: (id: string) => void;
  readonly onCloseMenu: () => void;
  readonly onOpenVacancies: () => void;
  readonly onAddManual: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
  readonly onOpenCompareOffers: () => void;
  readonly onOpenOfferEdit: (applicationId: string) => void;
}) {
  return (
    <>
      <BoardColumnsList
        columns={visibleColumns}
        state={state}
        activeMenuCardId={activeMenuCardId}
        onToggleMenu={onToggleMenu}
        onCloseMenu={onCloseMenu}
        onOpenVacancies={onOpenVacancies}
        onAddManual={onAddManual}
        onOpenExpert={onOpenExpert}
        onOpenCompareOffers={onOpenCompareOffers}
        onOpenOfferEdit={onOpenOfferEdit}
      />
      <ArchivedResponsesSection
        applications={state.applications.filter((a) => a.stage === 'archived')}
        initiallyOpen={initialArchiveOpen}
        onRestore={state.restoreFromArchive}
      />
    </>
  );
}

function BoardTabContent({
  state,
  visibleColumns,
  initialArchiveOpen,
  stageFilter,
  onClearFilter,
  onOpenVacancies,
  onOpenExpert,
}: {
  readonly state: UseApplications;
  readonly visibleColumns: readonly Column[];
  readonly initialArchiveOpen?: boolean;
  readonly stageFilter?: ApplicationStage | null;
  readonly onClearFilter?: () => void;
  readonly onOpenVacancies: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}) {
  const modals = useBoardModals();
  const [activeMenuCardId, setActiveMenuCardId] = useState<string | null>(null);

  return (
    <>
      <CandidateActionPanel
        applications={state.applications}
        onRefreshApplications={state.refreshApplications}
      />
      {stageFilter === 'interview' && onClearFilter ? (
        <FilterNotice onClear={onClearFilter} />
      ) : null}
      <Legend />
      <BoardColumnsAndArchive
        state={state}
        visibleColumns={visibleColumns}
        initialArchiveOpen={initialArchiveOpen}
        activeMenuCardId={activeMenuCardId}
        onToggleMenu={(id) => setActiveMenuCardId((cur) => (cur === id ? null : id))}
        onCloseMenu={() => setActiveMenuCardId(null)}
        onOpenVacancies={onOpenVacancies}
        onAddManual={modals.openManual}
        onOpenExpert={onOpenExpert}
        onOpenCompareOffers={modals.openCompare}
        onOpenOfferEdit={modals.openEditOffer}
      />
      <BoardModals state={state} modals={modals} />
    </>
  );
}

function ReadyBoard({
  state,
  onOpenVacancies,
  stageFilter,
  initialArchiveOpen,
  activeTab,
  onChangeTab,
  onClearFilter,
  onOpenExpert,
}: {
  state: UseApplications;
  onOpenVacancies: () => void;
  stageFilter?: ApplicationStage | null;
  initialArchiveOpen?: boolean;
  activeTab: 'board' | 'analytics';
  onChangeTab: (tab: 'board' | 'analytics') => void;
  onClearFilter?: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
}) {
  const visibleColumns = stageFilter
    ? COLUMNS.filter((column) => column.stages.includes(stageFilter))
    : COLUMNS;

  return (
    <div className="career-responses-board-wrap">
      <div className="career-responses-toolbar">
        <ResponsesViewSwitch tab={activeTab} onChange={onChangeTab} />
      </div>
      {activeTab === 'analytics' ? (
        <PipelineAnalyticsView
          applications={state.applications}
          onOpenVacancies={onOpenVacancies}
          onOpenExpert={onOpenExpert}
        />
      ) : (
        <BoardTabContent
          state={state}
          visibleColumns={visibleColumns}
          initialArchiveOpen={initialArchiveOpen}
          stageFilter={stageFilter}
          onClearFilter={onClearFilter}
          onOpenVacancies={onOpenVacancies}
          onOpenExpert={onOpenExpert}
        />
      )}
    </div>
  );
}

function ManualCardFormDialog({
  state,
  onCancel,
}: {
  readonly state: UseApplications;
  readonly onCancel: () => void;
}) {
  return (
    <ManualCardForm
      onCancel={onCancel}
      onSubmit={async (input) => {
        await state.addManualCard(input);
        onCancel();
      }}
    />
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
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
  onOpenCompareOffers?: () => void;
  onOpenOfferEdit?: (applicationId: string) => void;
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
  onOpenExpert,
  onOpenOfferEdit,
}: {
  application: ApplicationView;
  state: UseApplications;
  isMenuOpen: boolean;
  onToggleMenu: (id: string) => void;
  onCloseMenu: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
  onOpenOfferEdit?: (applicationId: string) => void;
}) {
  return (
    <ResponsesCard
      application={application}
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
      onMarkFollowUpSent={() => state.markFollowUpSent(application.id)}
      onSkip={(reasonId) => void state.skip(application, reasonId)}
      onOpenOfferEdit={onOpenOfferEdit}
    />
  );
}

function CompareOffersButton({
  count,
  onOpen,
}: {
  readonly count: number;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="career-responses-compare-btn"
      data-testid="compare-offers-btn"
      onClick={onOpen}
    >
      <Scales size={14} /> Сравнить офферы {count > 1 ? `(${count})` : ''}
    </button>
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
  onOpenExpert,
  onOpenCompareOffers,
  onOpenOfferEdit,
}: BoardColumnProps) {
  const cards = state.applications.filter(
    (application) =>
      column.stages.includes(application.stage) &&
      (application.stage !== 'applied' || isApplicationInDeliveryColumn(application, column.key)),
  );
  return (
    <section className="career-responses-column" aria-label={column.label}>
      <ColumnHeader label={column.label} count={cards.length} />
      <div className="career-responses-column-body">
        {column.key === 'offer' && cards.length > 0 && onOpenCompareOffers ? (
          <CompareOffersButton count={cards.length} onOpen={onOpenCompareOffers} />
        ) : null}
        {cards.map((application) => (
          <ColumnCardItem
            key={application.id}
            application={application}
            state={state}
            isMenuOpen={activeMenuCardId === application.id}
            onToggleMenu={onToggleMenu}
            onCloseMenu={onCloseMenu}
            onOpenExpert={onOpenExpert}
            onOpenOfferEdit={onOpenOfferEdit}
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

function isApplicationInDeliveryColumn(application: ApplicationView, columnKey: string): boolean {
  const state = deliveryState(application.stage, application.deliveryReceipt ?? null);
  return columnKey === 'attempted' ? state !== 'delivered' : state === 'delivered';
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
          <button type="button" aria-label="Ещё способы добавить карточку" onClick={onToggleMenu}>
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
