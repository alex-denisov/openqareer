import { useCallback, useMemo } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { updateAccountProfile, type AuthUser } from '../coach/coachApi';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { CareerHome } from './CareerHome';
import { SearchCampaign } from '../search/SearchCampaign';
import { ResumeStudio } from '../resume/ResumeStudio';
import { VacancyBoard } from '../vacancies/VacancyBoard';
import { useMatchedPool } from '../vacancies/useMatchedPool';
import { useVacancyApplications } from '../vacancies/useVacancyApplications';
import { useApplications } from '../applications/useApplications';
import { ResponsesBoard } from '../applications/ResponsesBoard';
import { AppErrorBoundary } from '../shell/AppErrorBoundary';
import { CareerPathIndicator } from '../shell/CareerPathIndicator';
import { buildPathIndicator } from '../shell/pathIndicator';
import { useCareerCabinetData } from './useCareerCabinetData';
import {
  applyRoutePremises,
  routePremisesAccountPatch,
  routePremisesDraft,
  type RoutePremisesDraft,
} from './routePremises';
import { cabinetJourney } from './cabinetJourney';
import { useRoleHypotheses } from '../career-map/useRoleHypotheses';
import { useCareerStrategy, type CareerStrategyRead } from './useCareerStrategy';
import { useWorkPreferences, type WorkPreferencesState } from './useWorkPreferences';
import type { ProposedRole } from '../../../shared/roleProposals';
import { countConfirmedApplications, type VacancyApplication } from '../../../shared/vacancyApplication';
import type { CareerCabinetView } from './cabinetViews';

export type { CareerCabinetView } from './cabinetViews';

interface CareerCabinetProps {
  view: CareerCabinetView;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  importing?: boolean;
  onNavigate: (view: CareerCabinetView) => void;
  onOpenTariffs?: () => void;
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
  onOpenTariffs,
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
  // Выбранная роль — версионированный объект, а не свободная строка анкеты:
  // кампания «Поиск» берёт направление из него (B180, срез 2).
  const strategy = useCareerStrategy();
  // Задания меняют порядок ролей, а не их состав (B180, срез 3).
  const workPreferences = useWorkPreferences();
  const vacancyApplications = useVacancyApplications();
  // B251 S3 — трекер откликов читает свой собственный API, независимо от
  // ручного лога `useVacancyApplications` (совместимость со старым `.app`).
  const applicationsTracker = useApplications();
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
          loading={data.loading && Boolean(data.snapshot)}
          error={data.error}
          onRetry={() => void data.refresh()}
        />
        {/* B248 §2 — the same path indicator the anonymous wizard shows
            (`CareerWorkspaceShell`), wired to the cabinet's own journey, pool
            and confirmed applications instead of a second read of any of
            them (INC-024, B104). */}
        {journey && !(data.loading && !data.snapshot) ? (
          <CareerPathIndicator
            steps={buildPathIndicator({
              track: journey.track,
              matchedPoolCount: pool.matched.length,
              confirmedApplications: countConfirmedApplications(
                vacancyApplications.applications,
              ),
            })}
            onNavigate={onNavigate}
          />
        ) : null}
        {/* До первого ответа сервера экран не рисует ни имени из сессии, ни
            пустых вкладок: профиль появляется целиком и один раз, а не
            «пустой, потом с данными импорта» (владелец, 2026-09-20). */}
        {data.loading && !data.snapshot ? (
          <CabinetSkeleton />
        ) : (
          <CabinetSection
            view={view}
            session={session}
            workspace={workspace}
            importing={importing}
            targetDirection={targetDirection}
            journey={journey}
            proposedRoles={proposedRoles}
            strategy={strategy}
            workPreferences={workPreferences}
            pool={pool}
            applications={vacancyApplications.applications}
            applicationsTracker={applicationsTracker}
            data={data}
            onNavigate={onNavigate}
            onUpdateWorkspace={onUpdateWorkspace}
            onSavePremises={savePremises}
            onOpenAccount={onOpenAccount}
            onOpenExpert={onOpenExpert}
            onOpenTariffs={onOpenTariffs}
          />
        )}
      </div>
    </AppErrorBoundary>
  );
}

function CabinetSkeleton() {
  return (
    <div className="career-cabinet-skeleton" aria-busy="true" aria-label="Читаем ваш профиль">
      <span className="career-skeleton-line is-wide" />
      <span className="career-skeleton-line" />
      <span className="career-skeleton-line is-short" />
    </div>
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
  strategy,
  workPreferences,
  pool,
  applications,
  applicationsTracker,
  data,
  onNavigate,
  onUpdateWorkspace,
  onSavePremises,
  onOpenAccount,
  onOpenExpert,
  onOpenTariffs,
}: {
  view: CareerCabinetView;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  importing: boolean;
  targetDirection: string;
  journey: ReturnType<typeof cabinetJourney>;
  proposedRoles: readonly ProposedRole[];
  strategy: CareerStrategyRead;
  workPreferences: WorkPreferencesState;
  pool: ReturnType<typeof useMatchedPool>;
  applications?: readonly VacancyApplication[];
  applicationsTracker: ReturnType<typeof useApplications>;
  data: ReturnType<typeof useCareerCabinetData>;
  onNavigate: (view: CareerCabinetView) => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  onSavePremises: (draft: RoutePremisesDraft) => Promise<void>;
  onOpenAccount: () => void;
  onOpenExpert: () => void;
  onOpenTariffs?: () => void;
}) {
  if (view === 'today') {
    return (
      <CareerHome
        session={session}
        snapshot={data.snapshot}
        account={data.account}
        workspace={workspace}
        targetDirection={targetDirection}
        journey={journey}
        proposedRoles={proposedRoles}
        strategy={strategy}
        workPreferences={workPreferences}
        poolComplete={pool.complete}
        poolTotal={pool.poolTotal}
        loading={data.loading}
        importing={importing}
        applications={applications}
        onRefresh={data.refresh}
        onNavigate={onNavigate}
        onUpdateWorkspace={onUpdateWorkspace}
        onOpenAccount={onOpenAccount}
        onOpenExpert={onOpenExpert}
      />
    );
  }
  // B248 (owner review 2026-09-23) — the rail's «Профиль» opens the resume
  // surface, not a second copy of «Сегодня». B265 replaces this with its own
  // profile screen; until then this is the nearest existing screen, not a
  // placeholder.
  if (view === 'resume' || view === 'profile') {
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
          strategy={strategy.strategy}
          premises={routePremisesDraft({ workspace, account: data.account })}
          premisesLoading={data.loading}
          onSavePremises={onSavePremises}
          onOpenVacancies={() => onNavigate('opportunities')}
          onOpenTariffs={onOpenTariffs ?? (() => undefined)}
        />
        {/* Регулярные выборки переехали в панель фильтров «Вакансий» (B181), а
            «ATS-читаемость» и «Следующее действие» живут на Главной: здесь тот
            же блок стоял целиком второй раз (B233, аудит 2026-09-20). */}
      </div>
    );
  }
  if (view === 'responses') {
    return <ResponsesBoard state={applicationsTracker} />;
  }
  return (
    <VacancyBoard
      candidateId={session.candidateId}
      subscriptions={data.snapshot?.vacancySubscriptions ?? []}
      defaultQuery={targetDirection || undefined}
      onRefresh={data.refresh}
      pool={pool}
      applications={applications}
      candidateFacts={data.snapshot?.memory ?? []}
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
  // «Профиль» renders the same surface as «Сегодня» today (B248 rail item
  // opens it) — its own heading, since the candidate clicked a named button
  // and a page titled «Сегодня» in reply would read as a broken link.
  profile: 'Профиль',
  resume: 'Резюме',
  career: 'Поиск',
  opportunities: 'Вакансии',
  responses: 'Отклики',
};

// Шапка раздела говорит, что человек здесь получит, а не как устроен модуль
// (B236, отчёты маркетолога и консультанта): без «пула», «выборок», «маршрута».
const VIEW_DESCRIPTION: Record<CareerCabinetView, string> = {
  today: 'Ваш профиль по фактам, роли с опорой на опыт и один шаг на сегодня.',
  profile:
    'Основное резюме и три формата позиционирования — только из подтверждённых фактов; пробелы видны.',
  resume:
    'Основное резюме и три формата позиционирования — только из подтверждённых фактов; пробелы видны.',
  career: 'Кампания: по какой роли ищем, что откликнуть сегодня, как идёт воронка.',
  opportunities:
    'Все вакансии по вашей роли из наших источников: фильтры, направления поиска и действия по каждой.',
  responses:
    'Весь активный поиск одним взглядом. Переписка, интервью и оффер живут на карточке — не отдельно.',
};

function todayLabel(): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}
