import { useMemo } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import type { AuthUser } from '../coach/coachApi';
import { buildCanonicalProfileJourney, type CareerJourney } from '../journey/careerJourneyEngine';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { CareerIntelligencePanel } from './CareerIntelligencePanel';
import { CareerProfileSurface } from './CareerProfileSurface';
import { CareerTodayBriefing } from './CareerTodayBriefing';
import { CareerTrackBoard } from './CareerTrackBoard';
import { ResumeStudio } from '../resume/ResumeStudio';
import { AppErrorBoundary } from '../shell/AppErrorBoundary';
import { useCareerCabinetData } from './useCareerCabinetData';
import type { CareerCabinetView } from './cabinetViews';

export type { CareerCabinetView } from './cabinetViews';

interface CareerCabinetProps {
  view: CareerCabinetView;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  journey?: CareerJourney;
  onNavigate: (view: CareerCabinetView) => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  onOpenAccount: () => void;
  onOpenExpert: () => void;
}

/**
 * One section, one subject (B148 §9):
 * «Сегодня» recommends, «Профиль» holds evidence, «Резюме» holds the document,
 * «Карьера» holds the route, «Возможности» holds the market. The strategist
 * dialogue lives only in the «Эксперт» drawer, so no screen duplicates it.
 */
// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
export function CareerCabinet({
  view,
  session,
  workspace,
  journey,
  onNavigate,
  onUpdateWorkspace,
  onOpenAccount,
  onOpenExpert,
}: CareerCabinetProps) {
  const data = useCareerCabinetData(session.candidateId);
  const name = data.account?.displayName ?? session.displayName ?? session.username;
  const targetDirection =
    data.account?.profile.headline?.trim() || workspace?.targetDirection || '';
  const canonicalJourney = useMemo(
    () =>
      data.snapshot
        ? buildCanonicalProfileJourney(
            journey,
            data.snapshot.memory,
            targetDirection,
            undefined,
            workspace?.constraints ?? '',
          )
        : journey,
    [data.snapshot, journey, targetDirection, workspace?.constraints],
  );

  return (
    <AppErrorBoundary
      fallbackTitle="Не удалось отобразить кабинет"
      fallbackMessage="При отображении разделов кабинета произошла ошибка. Ваши сохранённые данные в безопасности."
      onReset={() => void data.refresh()}
    >
      <div className={`career-cabinet career-cabinet-view-${view}`}>
        <CabinetHeader
          view={view}
          loading={data.loading}
          error={data.error}
          onRetry={() => void data.refresh()}
        />
        <CabinetSection
          view={view}
          name={name}
          session={session}
          workspace={workspace}
          journey={canonicalJourney}
          targetDirection={targetDirection}
          data={data}
          onNavigate={onNavigate}
          onUpdateWorkspace={onUpdateWorkspace}
          onOpenAccount={onOpenAccount}
          onOpenExpert={onOpenExpert}
        />
      </div>
    </AppErrorBoundary>
  );
}

// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
function CabinetSection({
  view,
  name,
  session,
  workspace,
  journey,
  targetDirection,
  data,
  onNavigate,
  onUpdateWorkspace,
  onOpenAccount,
  onOpenExpert,
}: {
  view: CareerCabinetView;
  name: string;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  journey?: CareerJourney;
  targetDirection: string;
  data: ReturnType<typeof useCareerCabinetData>;
  onNavigate: (view: CareerCabinetView) => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  onOpenAccount: () => void;
  onOpenExpert: () => void;
}) {
  if (view === 'today') {
    return (
      <CareerTodayBriefing
        name={name}
        journey={journey}
        snapshot={data.snapshot}
        resume={data.resume}
        account={data.account}
        workspace={workspace}
        loading={data.loading}
        onNavigate={onNavigate}
        onOpenExpert={onOpenExpert}
      />
    );
  }
  if (view === 'profile') {
    return (
      <CareerProfileSurface
        account={data.account}
        session={session}
        snapshot={data.snapshot}
        workspace={workspace}
        loading={data.loading}
        expanded
        onRefresh={data.refresh}
        onUpdateWorkspace={onUpdateWorkspace}
        onOpenAccount={onOpenAccount}
      />
    );
  }
  if (view === 'resume') {
    return (
      <ResumeStudio
        memory={data.snapshot?.memory ?? []}
        regions={workspace?.regions ?? []}
        onRefreshDossier={() => void data.refresh()}
      />
    );
  }
  if (view === 'career') {
    return (
      <CareerTrackBoard
        journey={journey}
        snapshot={data.snapshot}
        account={data.account}
        targetDirection={targetDirection}
        regions={workspace?.regions ?? []}
        onNavigate={onNavigate}
        onEditPremises={onOpenAccount}
      />
    );
  }
  return (
    <CareerIntelligencePanel
      snapshot={data.snapshot}
      journey={journey}
      defaultQuery={targetDirection || undefined}
      loading={data.loading}
      onRefresh={data.refresh}
      onNavigate={onNavigate}
      expanded
      onOpenExpert={onOpenExpert}
    />
  );
}

/**
 * The header states only what can actually be false. A permanent «Данные
 * актуальны» chip was a claim that could never fail, so it carried no
 * information and quietly implied a sync that does not exist (B148 §5).
 */
function CabinetHeader({
  view,
  loading,
  error,
  onRetry,
}: {
  view: CareerCabinetView;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  return (
    <header className="career-cabinet-header">
      <div>
        <span className="career-cabinet-kicker">{todayLabel()}</span>
        <h1>{VIEW_TITLE[view]}</h1>
        <p>{VIEW_DESCRIPTION[view]}</p>
      </div>
      {loading || error ? (
        <div className="career-cabinet-header-state">
          {error ? (
            <>
              <span className="is-error" role="alert">
                <WarningCircle size={16} weight="fill" />
                {error}
              </span>
              <button type="button" onClick={onRetry}>
                <ArrowClockwise size={15} />
                Повторить
              </button>
            </>
          ) : (
            <span className="is-loading">Обновляем…</span>
          )}
        </div>
      ) : null}
    </header>
  );
}

const VIEW_TITLE: Record<CareerCabinetView, string> = {
  today: 'Сегодня',
  profile: 'Профиль',
  resume: 'Резюме',
  career: 'Карьера',
  opportunities: 'Возможности',
};

const VIEW_DESCRIPTION: Record<CareerCabinetView, string> = {
  today: 'Одно следующее действие, его причина и состояние карьерного цикла.',
  profile: 'Кто вы по фактам: опыт, навыки, образование и документы.',
  resume:
    'Мастер-резюме и вариант под страну — только из подтверждённых фактов, с видимыми пробелами.',
  career: 'Гипотезы ролей, маршрут и наблюдаемые критерии проверки.',
  opportunities: 'Рынок, регулярные выборки вакансий и воронка откликов.',
};

function todayLabel(): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}
