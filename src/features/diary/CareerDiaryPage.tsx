import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import type { CareerDiaryGoalSummary } from '../../../shared/careerDiary';
import { useCareerDiaryMutations } from './useCareerDiaryMutations';
import { CareerDiaryGoalDetail } from './CareerDiaryGoalDetail';
import { CareerDiaryGoalForm } from './CareerDiaryGoalForm';
import { CareerDiaryGoalList } from './CareerDiaryGoalList';
import { CareerDiaryRecordList } from './CareerDiaryRecordList';
import { CareerDiarySummary } from './CareerDiarySummary';
import { CareerDiaryTabs } from './CareerDiaryTabs';
import type { CareerDiaryTab } from './useCareerDiaryRecords';
import { useCareerDiaryRecords } from './useCareerDiaryRecords';
import { useCareerDiaryGoalDetail } from './useCareerDiaryGoalDetail';
import { useCareerDiaryGoals } from './useCareerDiaryGoals';
import { useCareerDiaryOverview } from './useCareerDiaryOverview';
import './career-diary.css';

export interface CareerDiaryPageProps {
  readonly onOpenConsultant: (goal: CareerDiaryGoalSummary) => void;
}

export function CareerDiaryPage({ onOpenConsultant }: CareerDiaryPageProps) {
  const controller = useCareerDiaryController(onOpenConsultant);
  useDiaryNavigationFocus(controller.selectedGoalId, controller.formGoal !== undefined);
  return <CareerDiaryScreen {...controller} />;
}

function useDiaryNavigationFocus(selectedGoalId: string | null, formOpen: boolean) {
  const previousGoalId = useRef<string | null>(null);
  useEffect(() => {
    if (formOpen || previousGoalId.current === selectedGoalId) return;
    previousGoalId.current = selectedGoalId;
    const targetId = selectedGoalId ? 'career-diary-goal-title' : 'career-diary-goals-title';
    window.requestAnimationFrame(() => document.getElementById(targetId)?.focus());
  }, [formOpen, selectedGoalId]);
}

function useCareerDiaryController(onOpenConsultant: CareerDiaryPageProps['onOpenConsultant']) {
  const [activeTab, setActiveTab] = useState<CareerDiaryTab>('goals');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [formGoal, setFormGoal] = useState<CareerDiaryGoalSummary | null | undefined>(undefined);
  const overview = useCareerDiaryOverview();
  const goals = useCareerDiaryGoals();
  const records = useCareerDiaryRecords(activeTab);
  const detail = useCareerDiaryGoalDetail(selectedGoalId);
  const mutations = useCareerDiaryMutations({
    formGoal,
    selectedGoalId,
    reloadGoals: goals.reload,
    reloadOverview: overview.reload,
    reloadDetail: detail.reload,
    selectGoal: setSelectedGoalId,
  });
  const openNewGoal = useCallback(() => setFormGoal(null), []);
  const closeGoalForm = useCallback(() => setFormGoal(undefined), []);
  const openEditGoal = useCallback(() => setFormGoal(detail.goal), [detail.goal]);
  const selectTab = useCallback((tab: CareerDiaryTab) => {
    setActiveTab(tab);
    setSelectedGoalId(null);
  }, []);

  return {
    activeTab, selectTab, overview, goals, records, detail, selectedGoalId,
    setSelectedGoalId, formGoal, openNewGoal, openEditGoal, closeGoalForm,
    onOpenConsultant, ...mutations,
  };
}

function CareerDiaryScreen(props: ReturnType<typeof useCareerDiaryController>) {
  return (
    <div className="career-diary-page">
      <header className="career-diary-page__header">
        <h1 id="career-diary-heading" tabIndex={-1}>Карьерный дневник</h1>
        {props.activeTab === 'goals' && !props.selectedGoalId ? (
          <button className="career-btn is-primary" type="button" onClick={props.openNewGoal}>
            <Plus size={18} aria-hidden="true" />Добавить цель
          </button>
        ) : null}
      </header>
      <CareerDiarySummary {...props.overview} onRetry={props.overview.reload} />
      <CareerDiaryTabs activeTab={props.activeTab} overview={props.overview.overview} onChange={props.selectTab} />
      <DiaryTabPanel {...props} />
      {props.formGoal !== undefined ? (
        <CareerDiaryGoalForm
          goal={props.formGoal ?? undefined}
          onClose={props.closeGoalForm}
          onSave={props.saveGoal}
          onDelete={props.formGoal ? props.deleteGoal : undefined}
        />
      ) : null}
    </div>
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
      ) : <TabContent {...props} />}
    </div>
  );
}

function TabContent(props: ReturnType<typeof useCareerDiaryController>) {
  if (props.activeTab !== 'goals') {
    return (
      <CareerDiaryRecordList
        tab={props.activeTab}
        records={props.records.records}
        state={props.records.state}
        error={props.records.error}
        nextCursor={props.records.nextCursor}
        loadingMore={props.records.loadingMore}
        onRetry={props.records.reload}
        onLoadMore={props.records.loadMore}
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
