import { useCallback, useEffect, useRef, useState } from 'react';
import { CaretLeft, Plus } from '@phosphor-icons/react';
import type { CareerDiaryAchievement, CareerDiaryGoalSummary } from '../../../shared/careerDiary';
import { useCareerDiaryMutations } from './useCareerDiaryMutations';
import { CareerDiaryGoalDetail } from './CareerDiaryGoalDetail';
import { CareerDiaryGoalForm } from './CareerDiaryGoalForm';
import { CareerDiaryGoalList } from './CareerDiaryGoalList';
import { CareerDiaryAchievements } from './CareerDiaryAchievements';
import { CareerDiaryWeeklyReviews } from './CareerDiaryWeeklyReviews';
import { CareerDiarySummary } from './CareerDiarySummary';
import { CareerDiaryTabs } from './CareerDiaryTabs';
import type { CareerDiaryRecord, CareerDiaryTab } from './useCareerDiaryRecords';
import { useCareerDiaryRecords } from './useCareerDiaryRecords';
import { useCareerDiaryGoalDetail } from './useCareerDiaryGoalDetail';
import { useCareerDiaryGoals } from './useCareerDiaryGoals';
import { useCareerDiaryAchievementProfileStatuses } from './useCareerDiaryAchievementProfileStatuses';
import { useCareerDiaryOverview } from './useCareerDiaryOverview';
import { useCareerDiaryQuarterDecisions } from './useCareerDiaryQuarterDecisions';
import { useCareerDiaryAdaptationPlan } from './useCareerDiaryAdaptationPlan';
import { CareerDiaryQuarterReview } from './CareerDiaryQuarterReview';
import { CareerDiaryAdaptationPlanView } from './CareerDiaryAdaptationPlan';
import './career-diary.css';
import './career-diary-planning.css';

export interface CareerDiaryPageProps {
  readonly onOpenConsultant: (goal: CareerDiaryGoalSummary) => void;
}

export function CareerDiaryPage({ onOpenConsultant }: CareerDiaryPageProps) {
  const controller = useCareerDiaryController(onOpenConsultant);
  useDiaryNavigationFocus(
    controller.activeTab,
    controller.selectedGoalId,
    controller.formGoal !== undefined,
  );
  return <CareerDiaryScreen {...controller} />;
}

function useDiaryNavigationFocus(
  activeTab: CareerDiaryTab,
  selectedGoalId: string | null,
  formOpen: boolean,
) {
  const previousGoalId = useRef<string | null>(null);
  const previousTab = useRef<CareerDiaryTab>('goals');
  useEffect(() => {
    if (formOpen) return;
    const tabChanged = previousTab.current !== activeTab;
    const goalChanged = previousGoalId.current !== selectedGoalId;
    previousTab.current = activeTab;
    if (!tabChanged && !goalChanged) return;
    previousGoalId.current = selectedGoalId;
    const targetId = selectedGoalId
      ? 'career-diary-goal-title'
      : activeTab === 'quarter'
        ? 'career-diary-quarter-title'
        : activeTab === 'adaptation'
          ? 'career-diary-adaptation-title'
          : 'career-diary-goals-title';
    window.requestAnimationFrame(() => document.getElementById(targetId)?.focus());
  }, [activeTab, formOpen, selectedGoalId]);
}

function useCareerDiaryController(onOpenConsultant: CareerDiaryPageProps['onOpenConsultant']) {
  const [activeTab, setActiveTab] = useState<CareerDiaryTab>('goals');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [formGoal, setFormGoal] = useState<CareerDiaryGoalSummary | null | undefined>(undefined);
  const overview = useCareerDiaryOverview();
  const goals = useCareerDiaryGoals();
  const records = useCareerDiaryRecords(activeTab);
  const planning = useCareerDiaryPlanningTabs(activeTab, overview, goals);
  const detail = useCareerDiaryGoalDetail(selectedGoalId);
  const profileStatuses = useCareerDiaryPageStatuses(activeTab, records.records);
  const actions = useCareerDiaryControllerActions({
    setActiveTab,
    selectedGoalId,
    setSelectedGoalId,
    formGoal,
    setFormGoal,
    onOpenConsultant,
    overview,
    goals,
    records,
    detail,
    profileStatuses,
  });

  return {
    activeTab,
    overview,
    goals,
    records,
    detail,
    selectedGoalId,
    formGoal,
    profileStatuses,
    ...planning,
    ...actions,
  };
}

function useCareerDiaryPlanningTabs(
  activeTab: CareerDiaryTab,
  overview: ReturnType<typeof useCareerDiaryOverview>,
  goals: ReturnType<typeof useCareerDiaryGoals>,
) {
  const quarterDecisions = useCareerDiaryQuarterDecisions(
    goals.goals,
    overview.overview?.asOf ?? null,
    goals.reload,
    overview.reload,
  );
  const adaptation = useCareerDiaryAdaptationPlan(
    activeTab === 'adaptation',
    overview.overview?.primaryWorkplace ?? null,
    overview.overview?.asOf ?? null,
  );
  return { quarterDecisions, adaptation };
}

function useCareerDiaryPageStatuses(
  activeTab: CareerDiaryTab,
  records: readonly CareerDiaryRecord[],
) {
  return useCareerDiaryAchievementProfileStatuses(
    activeTab === 'achievements',
    records.filter(isAchievementRecord),
  );
}

function useCareerDiaryControllerActions({
  setActiveTab,
  selectedGoalId,
  setSelectedGoalId,
  formGoal,
  setFormGoal,
  onOpenConsultant,
  overview,
  goals,
  records,
  detail,
  profileStatuses,
}: {
  readonly setActiveTab: (tab: CareerDiaryTab) => void;
  readonly selectedGoalId: string | null;
  readonly setSelectedGoalId: (goalId: string | null) => void;
  readonly formGoal: CareerDiaryGoalSummary | null | undefined;
  readonly setFormGoal: (goal: CareerDiaryGoalSummary | null | undefined) => void;
  readonly onOpenConsultant: CareerDiaryPageProps['onOpenConsultant'];
  readonly overview: ReturnType<typeof useCareerDiaryOverview>;
  readonly goals: ReturnType<typeof useCareerDiaryGoals>;
  readonly records: ReturnType<typeof useCareerDiaryRecords>;
  readonly detail: ReturnType<typeof useCareerDiaryGoalDetail>;
  readonly profileStatuses: ReturnType<typeof useCareerDiaryAchievementProfileStatuses>;
}) {
  const mutations = useCareerDiaryMutations({
    formGoal,
    selectedGoalId,
    reloadGoals: goals.reload,
    reloadOverview: overview.reload,
    reloadDetail: detail.reload,
    selectGoal: setSelectedGoalId,
  });
  const goalFormActions = useCareerDiaryGoalFormActions(setFormGoal, detail.goal);
  const viewActions = useCareerDiaryViewActions(
    setActiveTab,
    setSelectedGoalId,
    records,
    overview,
    profileStatuses,
  );

  return {
    ...goalFormActions,
    ...viewActions,
    onOpenConsultant,
    ...mutations,
  };
}

function useCareerDiaryGoalFormActions(
  setFormGoal: (goal: CareerDiaryGoalSummary | null | undefined) => void,
  goal: CareerDiaryGoalSummary | null,
) {
  const openNewGoal = useCallback(() => setFormGoal(null), [setFormGoal]);
  const closeGoalForm = useCallback(() => setFormGoal(undefined), [setFormGoal]);
  const openEditGoal = useCallback(() => setFormGoal(goal), [goal, setFormGoal]);
  return { openNewGoal, closeGoalForm, openEditGoal };
}

function useCareerDiaryViewActions(
  setActiveTab: (tab: CareerDiaryTab) => void,
  setSelectedGoalId: (goalId: string | null) => void,
  records: ReturnType<typeof useCareerDiaryRecords>,
  overview: ReturnType<typeof useCareerDiaryOverview>,
  profileStatuses: ReturnType<typeof useCareerDiaryAchievementProfileStatuses>,
) {
  const reloadRecords = records.reload;
  const reloadOverview = overview.reload;
  const reloadProfileStatuses = profileStatuses.reload;
  const selectTab = useCallback(
    (tab: CareerDiaryTab) => {
      setActiveTab(tab);
      setSelectedGoalId(null);
    },
    [setActiveTab, setSelectedGoalId],
  );
  const reloadDiaryRecords = useCallback(() => {
    reloadRecords();
    reloadOverview();
    reloadProfileStatuses();
  }, [reloadOverview, reloadProfileStatuses, reloadRecords]);
  return { selectTab, reloadDiaryRecords, setSelectedGoalId };
}

function CareerDiaryScreen(props: ReturnType<typeof useCareerDiaryController>) {
  const planningView = props.activeTab === 'quarter' || props.activeTab === 'adaptation';
  return (
    <div className={`career-diary-page${planningView ? ' is-planning-view' : ''}`}>
      <CareerDiaryPageHeader props={props} planningView={planningView} />
      <CareerDiaryPageNavigation props={props} />
      <DiaryTabPanel {...props} />
      <CareerDiaryGoalFormOverlay props={props} />
    </div>
  );
}

function CareerDiaryPageHeader({
  props,
  planningView,
}: {
  readonly props: ReturnType<typeof useCareerDiaryController>;
  readonly planningView: boolean;
}) {
  return (
    <>
      {planningView ? (
        <header className="career-diary-mobile-push-header">
          <button
            className="career-btn is-ghost is-icon"
            type="button"
            aria-label="Назад к дневнику"
            onClick={() => props.selectTab('goals')}
          >
            <CaretLeft size={20} aria-hidden="true" />
          </button>
          <h2>{props.activeTab === 'quarter' ? 'Итоги квартала' : 'План адаптации'}</h2>
        </header>
      ) : null}
      <header className="career-diary-page__header">
        <h1 id="career-diary-heading" tabIndex={-1}>
          Карьерный дневник
        </h1>
        {props.activeTab === 'goals' && !props.selectedGoalId ? (
          <button className="career-btn is-primary" type="button" onClick={props.openNewGoal}>
            <Plus size={18} aria-hidden="true" />
            Добавить цель
          </button>
        ) : null}
      </header>
    </>
  );
}

function CareerDiaryPageNavigation({
  props,
}: {
  readonly props: ReturnType<typeof useCareerDiaryController>;
}) {
  return (
    <>
      <CareerDiarySummary {...props.overview} onRetry={props.overview.reload} />
      <CareerDiaryMobileLinks onSelectTab={props.selectTab} />
      <CareerDiaryTabs
        activeTab={props.activeTab}
        overview={props.overview.overview}
        onChange={props.selectTab}
      />
    </>
  );
}

function CareerDiaryMobileLinks({
  onSelectTab,
}: {
  readonly onSelectTab: (tab: CareerDiaryTab) => void;
}) {
  return (
    <nav className="career-diary-mobile-links" aria-label="Дополнительные разделы дневника">
      <button className="career-btn is-ghost" type="button" onClick={() => onSelectTab('quarter')}>
        Итоги квартала
      </button>
      <button
        className="career-btn is-ghost"
        type="button"
        onClick={() => onSelectTab('adaptation')}
      >
        План адаптации
      </button>
    </nav>
  );
}

function CareerDiaryGoalFormOverlay({
  props,
}: {
  readonly props: ReturnType<typeof useCareerDiaryController>;
}) {
  if (props.formGoal === undefined) return null;
  return (
    <CareerDiaryGoalForm
      goal={props.formGoal ?? undefined}
      onClose={props.closeGoalForm}
      onSave={props.saveGoal}
      onDelete={props.formGoal ? props.deleteGoal : undefined}
    />
  );
}

function DiaryTabPanel(props: ReturnType<typeof useCareerDiaryController>) {
  return (
    <div
      className="career-diary-tab-panel"
      id={`career-diary-panel-${props.activeTab}`}
      role="tabpanel"
      aria-labelledby={`career-diary-tab-${props.activeTab}`}
    >
      {props.selectedGoalId ? (
        <CareerDiaryGoalDetail
          goal={props.detail.goal}
          measurements={props.detail.measurements}
          nextCursor={props.detail.nextCursor}
          state={props.detail.state}
          error={props.detail.error}
          loadingMore={props.detail.loadingMore}
          measurementSaving={props.measurementSaving}
          onBack={() => props.setSelectedGoalId(null)}
          onEdit={props.openEditGoal}
          onAskConsultant={() => props.detail.goal && props.onOpenConsultant(props.detail.goal)}
          onLoadMore={props.detail.loadMore}
          onRecordMeasurement={props.saveMeasurement}
        />
      ) : (
        <TabContent {...props} />
      )}
    </div>
  );
}

function TabContent(props: ReturnType<typeof useCareerDiaryController>) {
  if (props.activeTab === 'quarter' || props.activeTab === 'adaptation') {
    return <CareerDiaryPlanningTab {...props} />;
  }
  return <CareerDiaryRecordsTab {...props} />;
}

function CareerDiaryPlanningTab(props: ReturnType<typeof useCareerDiaryController>) {
  if (props.activeTab === 'quarter') {
    return (
      <CareerDiaryQuarterReview
        asOf={props.overview.overview?.asOf ?? null}
        goals={props.goals.goals}
        state={props.goals.state}
        error={props.goals.error}
        decisionError={props.quarterDecisions.error}
        savingGoalId={props.quarterDecisions.savingGoalId}
        onRetry={props.goals.reload}
        onSaveDecision={props.quarterDecisions.saveDecision}
        onOpenConsultant={props.onOpenConsultant}
      />
    );
  }
  return (
    <CareerDiaryAdaptationPlanView
      asOf={props.overview.overview?.asOf ?? null}
      primaryWorkplace={props.overview.overview?.primaryWorkplace ?? null}
      adaptation={props.adaptation}
    />
  );
}

function CareerDiaryRecordsTab(props: ReturnType<typeof useCareerDiaryController>) {
  if (props.activeTab === 'reviews') {
    return (
      <CareerDiaryWeeklyReviews
        overview={props.overview.overview}
        records={props.records.records}
        state={props.records.state}
        error={props.records.error}
        nextCursor={props.records.nextCursor}
        loadingMore={props.records.loadingMore}
        onRetry={props.records.reload}
        onLoadMore={props.records.loadMore}
        onSaved={props.reloadDiaryRecords}
      />
    );
  }
  if (props.activeTab === 'achievements') {
    return (
      <CareerDiaryAchievements
        records={props.records.records}
        state={props.records.state}
        error={props.records.error}
        nextCursor={props.records.nextCursor}
        loadingMore={props.records.loadingMore}
        profileStatuses={props.profileStatuses.statuses}
        profileStatusesLoading={props.profileStatuses.loading}
        profileStatusesError={props.profileStatuses.error}
        onRetry={props.records.reload}
        onLoadMore={props.records.loadMore}
        onRetryProfileStatuses={props.profileStatuses.reload}
        onRecordsChanged={props.reloadDiaryRecords}
      />
    );
  }
  return (
    <CareerDiaryGoalList
      goals={props.goals.goals}
      state={props.goals.state}
      error={props.goals.error}
      loadMoreError={props.goals.loadMoreError}
      nextCursor={props.goals.nextCursor}
      loadingMore={props.goals.loadingMore}
      onRetry={props.goals.reload}
      onLoadMore={props.goals.loadMore}
      onOpenGoal={props.setSelectedGoalId}
    />
  );
}

function isAchievementRecord(record: CareerDiaryRecord): record is CareerDiaryAchievement {
  return 'situation' in record;
}
