import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { updateAccountProfile, type AuthUser } from '../coach/coachApi';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { visibleTargetDirection } from '../workspace/workspacePresentation';
import { TodayScreen } from '../today/TodayScreen';
import { useToday } from '../today/useToday';
import { SearchCampaign } from '../search/SearchCampaign';
import { ResumeStudio } from '../resume/ResumeStudio';
import { ProfileScreenView } from '../resume/ProfileScreenView';
import { ProfileTabs, type ProfileTab } from '../resume/profileTabs';
import { VacanciesScreen } from '../vacancies/VacanciesScreen';
import { useMatchedPool } from '../vacancies/useMatchedPool';
import { useVacancyApplications } from '../vacancies/useVacancyApplications';
import { useApplications } from '../applications/useApplications';
import type { ApplicationView } from '../applications/applicationsApi';
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
import { useCareerStrategy, type CareerStrategyRead } from './useCareerStrategy';
import { countConfirmedApplications } from '../../../shared/vacancyApplication';
import type { CareerCabinetView } from './cabinetViews';

export type { CareerCabinetView } from './cabinetViews';

interface CareerCabinetProps {
  view: CareerCabinetView;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  onNavigate: (view: CareerCabinetView) => void;
  onOpenTariffs?: () => void;
  onOpenConnections?: () => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
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
  onNavigate,
  onOpenTariffs,
  onOpenConnections,
  onUpdateWorkspace,
}: CareerCabinetProps) {
  const data = useCareerCabinetData(session.candidateId);
  // Карьерная картина вошедшего кандидата: анкета плюс факты с сервера.
  // Без неё «ATS-читаемость» и «Следующее действие» показывали пустые
  // состояния тому, у кого разобрано резюме (B103, B105).
  // Пул читается один раз на весь кабинет: раньше каждый раздел повторял
  // полсотни страниц подбора сам (B104).
  const pool = useMatchedPool();
  const campaignRoles = pool.campaign?.roles.value;
  // Кампания — текущая цель поиска. Импортированный headline и роль резюме
  // идут следом; старый ответ мастера остаётся в данных, но не перекрывает их.
  const targetDirection = visibleTargetDirection({
    campaignRoles,
    profileHeadline: data.account?.profile.headline,
    resumeTargetRole: data.snapshot?.resume?.draft?.targetRole,
    wizardTargetDirection: workspace?.targetDirection,
  });
  const journeyWorkspace = useMemo(
    () =>
      workspace && targetDirection !== workspace.targetDirection
        ? { ...workspace, targetDirection }
        : workspace,
    [targetDirection, workspace],
  );
  // Выбранная роль — версионированный объект, а не свободная строка анкеты:
  // кампания «Поиск» берёт направление из него (B180, срез 2).
  const strategy = useCareerStrategy();
  const vacancyApplications = useVacancyApplications();
  // B251 S3 — трекер откликов читает свой собственный API, независимо от
  // ручного лога `useVacancyApplications` (совместимость со старым `.app`).
  const applicationsTracker = useApplications();
  const journey = useMemo(
    () =>
      cabinetJourney({
        workspace: journeyWorkspace,
        memory: data.snapshot?.memory ?? [],
        targetDirection,
        pool: pool.matched,
      }),
    [journeyWorkspace, data.snapshot?.memory, targetDirection, pool.matched],
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
  // «Профиль / Документ и форматы» — в шапке страницы, справа от заголовка
  // «Профиль», а не рядом с карточкой кандидата: карточка — факты о человеке,
  // вкладки решают, что показывает весь экран (B265 review round 3).
  const [profileTab, setProfileTab] = useState<ProfileTab>('profile');
  const showsVacanciesScreen = view === 'opportunities';
  // B248 §2 — the same path indicator the anonymous wizard shows
  // (`CareerWorkspaceShell`), wired to the cabinet's own journey, pool and
  // confirmed applications instead of a second read of any of them
  // (INC-024, B104). «Вакансии» draws it itself, after its own heading, to
  // match the mockup order (приёмка B250 §a) — every other view keeps it here.
  const pathIndicatorSteps =
    journey && !(data.loading && !data.snapshot)
      ? buildPathIndicator({
          track: journey.track,
          matchedPoolCount: pool.matched.length,
          confirmedApplications: countConfirmedApplications(vacancyApplications.applications),
          activeResponses: countActiveResponses(applicationsTracker.applications),
          nearestInterview: nearestInterviewOf(applicationsTracker.applications),
        })
      : undefined;

  return (
    <AppErrorBoundary
      fallbackTitle="Не удалось отобразить кабинет"
      fallbackMessage="При отображении разделов кабинета произошла ошибка. Ваши сохранённые данные в безопасности."
      onReset={() => void data.refresh()}
    >
      <div className={`career-cabinet career-cabinet-view-${view}`}>
        {/* «Вакансии» рисует свой эйброу/заголовок/подзаголовок из данных
            кампании (B248/B250) — общая шапка кабинета здесь дублировала бы
            их дженериковой версией (приёмка B250). Доска-заглушка
            (загрузка/ошибка/пусто) общей шапкой ещё пользуется. */}
        {!showsVacanciesScreen ? (
          <CabinetHeader
            view={view}
            loading={data.loading && Boolean(data.snapshot)}
            error={data.error}
            onRetry={() => void data.refresh()}
            tabs={view === 'profile' ? <ProfileTabs tab={profileTab} onTab={setProfileTab} /> : undefined}
          />
        ) : null}
        {pathIndicatorSteps && !showsVacanciesScreen ? (
          <CareerPathIndicator steps={pathIndicatorSteps} onNavigate={onNavigate} />
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
            targetDirection={targetDirection}
            strategy={strategy}
            pool={pool}
            vacancyApplications={vacancyApplications}
            pathIndicatorSteps={pathIndicatorSteps}
            applicationsTracker={applicationsTracker}
            data={data}
            profileTab={profileTab}
            onNavigate={onNavigate}
            onSavePremises={savePremises}
            onOpenTariffs={onOpenTariffs}
            onOpenConnections={onOpenConnections}
            onUpdateWorkspace={onUpdateWorkspace}
          />
        )}
      </div>
    </AppErrorBoundary>
  );
}

/** «Сегодня» reads its own digest through `useToday` — the cabinet's
 * `useCareerCabinetData` snapshot has no queue or digest fields of its own. */
function TodaySection() {
  const { snapshot, loading, failed, refresh, markFollowUpSent } = useToday();
  return (
    <TodayScreen
      snapshot={snapshot}
      loading={loading}
      failed={failed}
      onRetry={() => void refresh()}
      onMarkFollowUpSent={markFollowUpSent}
    />
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
  targetDirection,
  strategy,
  pool,
  vacancyApplications,
  pathIndicatorSteps,
  applicationsTracker,
  data,
  profileTab,
  onNavigate,
  onSavePremises,
  onOpenTariffs,
  onOpenConnections,
  onUpdateWorkspace,
}: {
  view: CareerCabinetView;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  targetDirection: string;
  strategy: CareerStrategyRead;
  pool: ReturnType<typeof useMatchedPool>;
  vacancyApplications: ReturnType<typeof useVacancyApplications>;
  pathIndicatorSteps?: ReturnType<typeof buildPathIndicator>;
  applicationsTracker: ReturnType<typeof useApplications>;
  data: ReturnType<typeof useCareerCabinetData>;
  profileTab: ProfileTab;
  onNavigate: (view: CareerCabinetView) => void;
  onSavePremises: (draft: RoutePremisesDraft) => Promise<void>;
  onOpenTariffs?: () => void;
  onOpenConnections?: () => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
}) {
  if (view === 'today') {
    return <TodaySection />;
  }
  // B265 — the rail's «Профиль» is its own screen (topcard, Open to work,
  // every imported section, edit-in-place), not Resume Studio. «Резюме»
  // (`view === 'resume'`) is no longer a reachable rail item but keeps
  // pointing at Resume Studio for anyone with a stored link to it.
  if (view === 'profile') {
    return (
      <ProfileScreenView
        candidateId={session.candidateId}
        memory={data.snapshot?.memory ?? []}
        importedSources={data.snapshot?.importedSources}
        onRefreshFacts={() => void data.refresh()}
        onOpenConnections={onOpenConnections}
        tab={profileTab}
        workspace={workspace}
        onUpdateWorkspace={onUpdateWorkspace}
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
          strategy={strategy.strategy}
          premises={routePremisesDraft({
            workspace,
            account: data.account,
            visibleTargetRole: targetDirection,
          })}
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
    return (
      <ResponsesBoard state={applicationsTracker} onOpenVacancies={() => onNavigate('opportunities')} />
    );
  }
  return (
    <VacanciesScreen
      matched={pool.matched}
      total={pool.total || pool.matched.length}
      campaign={pool.campaign}
      candidateLevel={pool.candidateLevel}
      loading={pool.loading}
      failed={pool.failed}
      failureSourceLabel={pool.failureSourceLabel}
      onRetry={pool.refresh}
      applications={vacancyApplications}
      pathIndicator={
        pathIndicatorSteps ? { steps: pathIndicatorSteps, onNavigate } : undefined
      }
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
  tabs,
}: {
  view: CareerCabinetView;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  /** «Профиль / Документ и форматы» — only the profile view sends one. */
  tabs?: ReactNode;
}) {
  return (
    <header className="career-cabinet-header">
      <div>
        <span className="career-cabinet-kicker">{view === 'responses' ? 'Пайплайн' : todayLabel()}</span>
        <h1>{VIEW_TITLE[view]}</h1>
        <p>{VIEW_DESCRIPTION[view]}</p>
      </div>
      {tabs || loading || error ? (
        <div className="career-cabinet-header-right">
          {tabs}
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

/** Cards still live on the «Отклики» board — everything but rejected/archived (B251 S4). */
function countActiveResponses(applications: readonly ApplicationView[]): number {
  return applications.filter(
    (application) => application.stage !== 'rejected' && application.stage !== 'archived',
  ).length;
}

/** The nearest scheduled interview across the tracker, for the path indicator's «Интервью» step. */
function nearestInterviewOf(
  applications: readonly ApplicationView[],
): { company: string; scheduledAt: string } | null {
  const withInterview = applications
    .filter((application) => application.nearestInterview?.scheduledAt)
    .sort((a, b) =>
      (a.nearestInterview?.scheduledAt as string).localeCompare(b.nearestInterview?.scheduledAt as string),
    );
  const nearest = withInterview[0];
  if (!nearest?.nearestInterview?.scheduledAt) return null;
  return {
    company: nearest.vacancy?.companyHidden ? 'Компания скрыта' : nearest.vacancy?.company || 'Компания не указана',
    scheduledAt: nearest.nearestInterview.scheduledAt,
  };
}
