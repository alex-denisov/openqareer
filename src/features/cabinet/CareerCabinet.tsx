import { useCallback, useMemo } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { updateAccountProfile, type AuthUser } from '../coach/coachApi';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { CareerHome } from './CareerHome';
import { CareerIntelligencePanel } from './CareerIntelligencePanel';
import { SearchCampaign } from '../search/SearchCampaign';
import { ResumeStudio } from '../resume/ResumeStudio';
import { VacancyBoard } from '../vacancies/VacancyBoard';
import { useMatchedPool } from '../vacancies/useMatchedPool';
import { AppErrorBoundary } from '../shell/AppErrorBoundary';
import { useCareerCabinetData } from './useCareerCabinetData';
import {
  applyRoutePremises,
  routePremisesAccountPatch,
  routePremisesDraft,
  type RoutePremisesDraft,
} from './routePremises';
import { cabinetJourney } from './cabinetJourney';
import { useRoleHypotheses } from '../career-map/useRoleHypotheses';
import type { ProposedRole } from '../../../shared/roleProposals';
import type { CareerCabinetView } from './cabinetViews';

export type { CareerCabinetView } from './cabinetViews';

interface CareerCabinetProps {
  view: CareerCabinetView;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  importing?: boolean;
  onNavigate: (view: CareerCabinetView) => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  onOpenAccount: () => void;
  onOpenExpert: () => void;
}

/**
 * One section, one subject (B148 §9), as «Пульт» redrew it:
 * «Главная» holds the candidate and what to do next, «Резюме» holds the document,
 * «Поиск» holds the campaign, «Вакансии» holds the collected pool. The strategist
 * dialogue lives only in the «Эксперт» drawer, so no screen duplicates it.
 */
// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
export function CareerCabinet({
  view,
  session,
  workspace,
  importing = false,
  onNavigate,
  onUpdateWorkspace,
  onOpenAccount,
  onOpenExpert,
}: CareerCabinetProps) {
  const data = useCareerCabinetData(session.candidateId);
  // Роль из разобранного резюме — такой же ответ кандидата, как поле анкеты.
  // Без неё «Позиционирование» писало «Не названа» рядом с той же ролью в
  // шапке профиля (B179).
  const targetDirection =
    data.account?.profile.headline?.trim() ||
    workspace?.targetDirection?.trim() ||
    data.snapshot?.resume?.draft?.targetRole?.trim() ||
    '';
  // Карьерная картина вошедшего кандидата: анкета плюс факты с сервера.
  // Без неё «ATS-читаемость» и «Следующее действие» показывали пустые
  // состояния тому, у кого разобрано резюме (B103, B105).
  // Пул читается один раз на весь кабинет: раньше каждый раздел повторял
  // полсотни страниц подбора сам (B104).
  const pool = useMatchedPool();
  // Имя роли берётся у рынка, а не у строки резюме: на «Главной» гипотезой
  // печаталась целая фраза из профиля, за которой нет ни одной вакансии (B180).
  // Считает их сервер (срез 1б): в браузер пул приезжает без требований —
  // страница подбора вырезает их ради байтового бюджета маршрута (INC-029).
  const proposedRoles = useRoleHypotheses().roles;
  const journey = useMemo(
    () =>
      cabinetJourney({
        workspace,
        memory: data.snapshot?.memory ?? [],
        targetDirection,
        pool: pool.matched,
      }),
    [workspace, data.snapshot?.memory, targetDirection, pool.matched],
  );

  const savePremises = useCallback(
    async (draft: RoutePremisesDraft) => {
      // Regions and the role live in the workspace. Without one there is
      // nowhere to put them, and saving only the account half would drop the
      // candidate's geography without saying so.
      if (!workspace) {
        throw new Error(
          'сначала завершите карьерную диагностику — регионы и роль хранятся в её ответах',
        );
      }
      const patch = routePremisesAccountPatch(draft, data.account);
      if (patch) {
        data.setAccount(await updateAccountProfile(patch));
      }
      // `onUpdateWorkspace` is the same write-through the wizard uses, so the
      // answers reach `PUT /candidate/workspace` and survive this browser.
      onUpdateWorkspace(applyRoutePremises(workspace, draft));
    },
    [data, onUpdateWorkspace, workspace],
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
          session={session}
          workspace={workspace}
          importing={importing}
          targetDirection={targetDirection}
          journey={journey}
          proposedRoles={proposedRoles}
          pool={pool}
          data={data}
          onNavigate={onNavigate}
          onUpdateWorkspace={onUpdateWorkspace}
          onSavePremises={savePremises}
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
  session,
  workspace,
  importing,
  targetDirection,
  journey,
  proposedRoles,
  pool,
  data,
  onNavigate,
  onUpdateWorkspace,
  onSavePremises,
  onOpenAccount,
  onOpenExpert,
}: {
  view: CareerCabinetView;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  importing: boolean;
  targetDirection: string;
  journey: ReturnType<typeof cabinetJourney>;
  proposedRoles: readonly ProposedRole[];
  pool: ReturnType<typeof useMatchedPool>;
  data: ReturnType<typeof useCareerCabinetData>;
  onNavigate: (view: CareerCabinetView) => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  onSavePremises: (draft: RoutePremisesDraft) => Promise<void>;
  onOpenAccount: () => void;
  onOpenExpert: () => void;
}) {
  // «Главная» держит кандидата и его факты: отдельный раздел «Профиль» показывал
  // бы то же самое второй раз, поэтому его прежний адрес ведёт сюда же.
  if (view === 'today' || view === 'profile') {
    return (
      <CareerHome
        session={session}
        snapshot={data.snapshot}
        account={data.account}
        workspace={workspace}
        targetDirection={targetDirection}
        journey={journey}
        proposedRoles={proposedRoles}
        poolComplete={pool.complete}
        poolTotal={pool.poolTotal}
        loading={data.loading}
        importing={importing}
        onRefresh={data.refresh}
        onNavigate={onNavigate}
        onUpdateWorkspace={onUpdateWorkspace}
        onOpenAccount={onOpenAccount}
        onOpenExpert={onOpenExpert}
      />
    );
  }
  if (view === 'resume') {
    return (
      <ResumeStudio
        memory={data.snapshot?.memory ?? []}
        importedSources={data.snapshot?.importedSources}
        regions={workspace?.regions ?? []}
        onRefreshFacts={() => void data.refresh()}
      />
    );
  }
  // «Поиск» — одна кампания: на чём ищем (роль, регион, маршрут) и чем ищем
  // (регулярные выборки по источникам). Раньше это были два раздела, и
  // кандидат настраивал поиск отдельно от того, ради чего он идёт.
  if (view === 'career') {
    return (
      <div className="career-search-board">
        <SearchCampaign
          targetDirection={targetDirection}
          premises={routePremisesDraft({ workspace, account: data.account })}
          premisesLoading={data.loading}
          onSavePremises={onSavePremises}
          onOpenVacancies={() => onNavigate('opportunities')}
        />
        {/* Регулярные выборки переехали в панель фильтров «Вакансий» — туда,
            где кандидат смотрит сам пул (решение владельца 2026-09-02, B181).
            Здесь остались читаемость резюме и следующий шаг. */}
        <CareerIntelligencePanel
          snapshot={data.snapshot}
          journey={journey}
          loading={data.loading}
          onNavigate={onNavigate}
          onOpenExpert={onOpenExpert}
        />
      </div>
    );
  }
  return (
    <VacancyBoard
      subscriptions={data.snapshot?.vacancySubscriptions ?? []}
      defaultQuery={targetDirection || undefined}
      onRefresh={data.refresh}
      pool={pool}
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
  today: 'Главная',
  profile: 'Главная',
  resume: 'Резюме',
  career: 'Поиск',
  opportunities: 'Вакансии',
};

const VIEW_DESCRIPTION: Record<CareerCabinetView, string> = {
  today: 'Кто вы по фактам, что с этим делать дальше и как это читает рынок.',
  profile: 'Кто вы по фактам, что с этим делать дальше и как это читает рынок.',
  resume:
    'Мастер-резюме и вариант под страну — только из подтверждённых фактов, с видимыми пробелами.',
  career: 'Кампания поиска: роль, условия, маршрут и воронка.',
  opportunities: 'Весь собранный пул, фильтры и регулярные выборки по источникам.',
};

function todayLabel(): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}
