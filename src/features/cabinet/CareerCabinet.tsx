import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import {
  updateAccountProfile,
  type AuthUser,
  type CoachTurnStage,
  type CoachTurnSubject,
} from '../coach/coachApi';
import { saveCandidateCampaign } from '../coach/matchedVacancyApi';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { visibleTargetDirection } from '../workspace/workspacePresentation';
import { TodayScreen } from '../today/TodayScreen';
import { useToday } from '../today/useToday';
import { ResumeStudio } from '../resume/ResumeStudio';
import { ProfileScreenView } from '../resume/ProfileScreenView';
import { ProfileTabs, type ProfileTab } from '../resume/profileTabs';
import { VacanciesPoolScreen } from '../vacancies/VacanciesPoolScreen';
import { useMatchedPool } from '../vacancies/useMatchedPool';
import { useVacancyApplications } from '../vacancies/useVacancyApplications';
import { useApplications } from '../applications/useApplications';
import type { ApplicationView } from '../applications/applicationsApi';
import { ResponsesBoard } from '../applications/ResponsesBoard';
import { AppErrorBoundary } from '../shell/AppErrorBoundary';
import { CareerPathIndicator } from '../shell/CareerPathIndicator';
import { PageHeader } from '../shell/PageHeader';
import { buildPathIndicator } from '../shell/pathIndicator';
import { CareerTodaySkeleton } from '../shell/CareerTodaySkeleton';
import { useCareerCabinetData } from './useCareerCabinetData';
import {
  applyRoutePremises,
  routePremisesAccountPatch,
  routePremisesDraft,
  type RoutePremisesDraft,
} from './routePremises';
import { cabinetJourney } from './cabinetJourney';
import { isClosedApplicationStage } from '../../../shared/applicationStage';
import { countConfirmedApplications } from '../../../shared/vacancyApplication';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import type {
  VacancyProfileRequirement,
  VacancyProfileRequirementRequest,
} from '../vacancies/vacancyProfileRequirement';
import type { NavigationOptions } from '../shell/pathIndicator';
import type { CareerCabinetView } from './cabinetViews';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';

export type { CareerCabinetView } from './cabinetViews';

function stageForCabinetView(view: CareerCabinetView): CoachTurnStage {
  switch (view) {
    case 'profile':
    case 'resume':
      return 'profile';
    case 'career':
    case 'opportunities':
      return 'vacancies';
    case 'responses':
      return 'responses';
    case 'today':
    default:
      return 'today';
  }
}

interface CareerCabinetProps {
  view: CareerCabinetView;
  navigationOptions?: NavigationOptions;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  onNavigate: (view: CareerCabinetView, options?: NavigationOptions) => void;
  onOpenTariffs?: () => void;
  onOpenConnections?: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
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
  navigationOptions,
  session,
  workspace,
  onNavigate,
  onOpenTariffs,
  onOpenConnections,
  onOpenExpert,
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
  const vacancyApplications = useVacancyApplications();
  // B251 S3 — трекер откликов читает свой собственный API, независимо от
  // ручного лога `useVacancyApplications` (совместимость со старым `.app`).
  const applicationsTracker = useApplications();
  const archivedApplicationClusterIds = useMemo(
    () =>
      new Set(
        applicationsTracker.applications
          .filter((application) => application.stage === 'archived' && application.clusterId)
          .map((application) => application.clusterId as string),
      ),
    [applicationsTracker.applications],
  );
  const recordConfirmedVacancy = vacancyApplications.recordConfirmed;
  const refreshApplications = applicationsTracker.refreshApplications;
  const addManualCard = applicationsTracker.addManualCard;
  const scheduleInterview = applicationsTracker.scheduleInterview;
  const markVacancyAlreadyApplied = useCallback(
    (clusterId: string, vacancy: VacancyApplicationSnapshot) =>
      recordConfirmedVacancy(clusterId, 'applied', vacancy),
    [recordConfirmedVacancy],
  );
  const scheduleVacancyInterview = useCallback(
    async (clusterId: string, scheduledAt: string, vacancy: VacancyApplicationSnapshot) => {
      const currentApplications = await refreshApplications();
      const existing = currentApplications.find(
        (application) => application.clusterId === clusterId,
      );
      const application =
        existing ??
        (await addManualCard({
          clusterId,
          manualVacancy: vacancy,
          stage: 'applied',
        }));
      try {
        await scheduleInterview(application.id, scheduledAt);
        return application;
      } catch (reason) {
        const refreshed = await refreshApplications();
        const saved = refreshed.find((current) => current.id === application.id);
        if (saved?.stage === 'interview' && saved.nearestInterview?.scheduledAt === scheduledAt) {
          return saved;
        }
        throw reason;
      }
    },
    [addManualCard, refreshApplications, scheduleInterview],
  );
  // B251 F5 (C47) — confirming an application in «Вакансии» must land a card
  // in «Отклики»: the two logs live in different tables (server/data), so a
  // plain vacancyApplications.record() left the tracker empty forever.
  const trackedVacancyApplications = useMemo(
    () => ({
      ...vacancyApplications,
      record: (
        clusterId: Parameters<typeof vacancyApplications.record>[0],
        status: Parameters<typeof vacancyApplications.record>[1],
        vacancy: Parameters<typeof vacancyApplications.record>[2],
      ) => {
        if (status === 'applied') {
          // Запись отклика атомарно создаёт карточку на сервере. Не создаём
          // локальную карточку, пока эта запись не подтверждена.
          void vacancyApplications
            .recordConfirmed(clusterId, status, vacancy)
            .then(() => applicationsTracker.refreshApplications())
            .catch(() => undefined);
          return;
        }
        vacancyApplications.record(clusterId, status, vacancy);
      },
    }),
    [vacancyApplications, applicationsTracker],
  );
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
      // Role and regions are campaign inputs as well as wizard answers.
      // Without a workspace there is nowhere to keep the candidate's route.
      if (!workspace) {
        throw new Error(
          'сначала завершите карьерную диагностику — регионы и роль хранятся в её ответах',
        );
      }
      const patch = routePremisesAccountPatch(draft, data.account);
      if (patch) {
        data.setAccount(await updateAccountProfile(patch));
      }
      // Keep the original answers in sync with the explicit campaign selection.
      onUpdateWorkspace(applyRoutePremises(workspace, draft));
      const targetRole = draft.targetRole.trim();
      const preservedRoles = pool.campaign?.roles.value.length
        ? [...pool.campaign.roles.value]
        : targetDirection.trim()
          ? [targetDirection.trim()]
          : [];
      await saveCandidateCampaign({
        roles: targetRole ? [targetRole] : preservedRoles,
        regions: [...draft.regions],
      });
      pool.refresh?.();
    },
    [data, onUpdateWorkspace, pool, targetDirection, workspace],
  );
  // «Профиль / Документ и форматы» — в шапке страницы, справа от заголовка
  // «Профиль», а не рядом с карточкой кандидата: карточка — факты о человеке,
  // вкладки решают, что показывает весь экран (B265 review round 3).
  const [profileTab, setProfileTab] = useState<ProfileTab>('profile');
  const [vacancyProfileRequest, setVacancyProfileRequest] =
    useState<VacancyProfileRequirementRequest | null>(null);
  const openProfileRequirement = useCallback(
    (context: VacancyProfileRequirement) => {
      setVacancyProfileRequest({ ...context, requestId: crypto.randomUUID() });
      onNavigate('profile');
    },
    [onNavigate],
  );
  const clearProfileRequirement = useCallback(() => setVacancyProfileRequest(null), []);
  const showsVacanciesScreen = view === 'opportunities';
  // B248 §2 — the same path indicator the anonymous wizard shows
  // (`CareerWorkspaceShell`), wired to the cabinet's own journey, pool and
  // confirmed applications instead of a second read of any of them
  // (INC-024, B104). «Вакансии» draws it itself, after its own heading, to
  const hasInterviewStage =
    applicationsTracker.applications.some(
      (app) => app.stage === 'interview' || app.stage === 'offer',
    ) || Boolean(nearestInterviewOf(applicationsTracker.applications));

  const pathIndicatorSteps =
    journey && !(data.loading && !data.snapshot)
      ? buildPathIndicator({
          track: journey.track,
          matchedPoolCount: pool.matched.length,
          confirmedApplications: countConfirmedApplications(vacancyApplications.applications),
          activeResponses: countActiveResponses(applicationsTracker.applications),
          nearestInterview: nearestInterviewOf(applicationsTracker.applications),
          activeSection: view,
          hasInterviewStage,
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
            loading={data.loading}
            loadingMessage={data.snapshot ? 'Обновляем…' : 'Проверяем вход и читаем ваш профиль'}
            error={data.error}
            onRetry={() => void data.refresh()}
            onAskConsultant={
              onOpenExpert ? () => onOpenExpert(stageForCabinetView(view)) : undefined
            }
            tabs={
              view === 'profile' ? (
                <ProfileTabs tab={profileTab} onTab={setProfileTab} />
              ) : undefined
            }
          />
        ) : null}
        {pathIndicatorSteps && !showsVacanciesScreen ? (
          <CareerPathIndicator steps={pathIndicatorSteps} onNavigate={onNavigate} />
        ) : null}
        {/* До первого ответа сервера экран не рисует ни имени из сессии, ни
            пустых вкладок: профиль появляется целиком и один раз, а не
            «пустой, потом с данными импорта» (владелец, 2026-09-20). */}
        {data.loading && !data.snapshot ? (
          <CareerTodaySkeleton showHeading={false} />
        ) : (
          <CabinetSection
            view={view}
            session={session}
            workspace={workspace}
            targetDirection={targetDirection}
            pool={pool}
            vacancyApplications={trackedVacancyApplications}
            pathIndicatorSteps={pathIndicatorSteps}
            applicationsTracker={applicationsTracker}
            archivedApplicationClusterIds={archivedApplicationClusterIds}
            onMarkAlreadyApplied={markVacancyAlreadyApplied}
            onScheduleInterview={scheduleVacancyInterview}
            data={data}
            profileTab={profileTab}
            vacancyProfileRequest={vacancyProfileRequest}
            consultantAction={journey?.reasonedAction}
            navigationOptions={navigationOptions}
            onNavigate={onNavigate}
            onOpenProfileRequirement={openProfileRequirement}
            onVacancyRequirementHandled={clearProfileRequirement}
            onSavePremises={savePremises}
            onOpenTariffs={onOpenTariffs}
            onOpenConnections={onOpenConnections}
            onOpenExpert={onOpenExpert}
            onUpdateWorkspace={onUpdateWorkspace}
          />
        )}
      </div>
    </AppErrorBoundary>
  );
}

/** «Сегодня» reads its own digest through `useToday` — the cabinet's
 * `useCareerCabinetData` snapshot has no queue or digest fields of its own. */
function TodaySection({
  onOpenTariffs,
  candidateId,
  consultantAction,
  onNavigate,
}: {
  candidateId?: string;
  consultantAction?: ReasonedCareerAction;
  onNavigate?: (view: CareerCabinetView) => void;
  onOpenTariffs?: () => void;
}) {
  const { snapshot, loading, failed, refresh, markFollowUpSent, markingFollowUpIds } = useToday();
  return (
    <TodayScreen
      onOpenTariffs={onOpenTariffs}
      snapshot={snapshot}
      loading={loading}
      failed={failed}
      onRetry={() => void refresh()}
      onMarkFollowUpSent={markFollowUpSent}
      markingFollowUpIds={markingFollowUpIds}
      candidateId={candidateId}
      consultantAction={consultantAction}
      onNavigate={onNavigate}
    />
  );
}

// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
function CabinetSection({
  view,
  session,
  workspace,
  targetDirection,
  pool,
  vacancyApplications,
  pathIndicatorSteps,
  applicationsTracker,
  archivedApplicationClusterIds,
  onMarkAlreadyApplied,
  onScheduleInterview,
  data,
  profileTab,
  vacancyProfileRequest,
  consultantAction,
  navigationOptions,
  onNavigate,
  onOpenProfileRequirement,
  onVacancyRequirementHandled,
  onSavePremises,
  onOpenTariffs,
  onOpenConnections,
  onOpenExpert,
  onUpdateWorkspace,
}: {
  view: CareerCabinetView;
  navigationOptions?: NavigationOptions;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  targetDirection: string;
  pool: ReturnType<typeof useMatchedPool>;
  vacancyApplications: ReturnType<typeof useVacancyApplications>;
  pathIndicatorSteps?: ReturnType<typeof buildPathIndicator>;
  applicationsTracker: ReturnType<typeof useApplications>;
  archivedApplicationClusterIds: ReadonlySet<string>;
  onMarkAlreadyApplied: (clusterId: string, vacancy: VacancyApplicationSnapshot) => Promise<void>;
  onScheduleInterview: (
    clusterId: string,
    scheduledAt: string,
    vacancy: VacancyApplicationSnapshot,
  ) => Promise<ApplicationView>;
  data: ReturnType<typeof useCareerCabinetData>;
  profileTab: ProfileTab;
  vacancyProfileRequest: VacancyProfileRequirementRequest | null;
  consultantAction?: ReasonedCareerAction;
  onNavigate: (view: CareerCabinetView, options?: NavigationOptions) => void;
  onOpenProfileRequirement: (context: VacancyProfileRequirement) => void;
  onVacancyRequirementHandled: () => void;
  onSavePremises: (draft: RoutePremisesDraft) => Promise<void>;
  onOpenTariffs?: () => void;
  onOpenConnections?: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
}) {
  useEffect(() => {
    if (view === 'career') {
      onNavigate('opportunities');
    }
  }, [view, onNavigate]);

  if (view === 'today') {
    return (
      <TodaySection
        onOpenTariffs={onOpenTariffs}
        candidateId={session.candidateId}
        consultantAction={consultantAction}
        onNavigate={onNavigate}
      />
    );
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
        vacancyRequirement={vacancyProfileRequest ?? undefined}
        onVacancyRequirementHandled={onVacancyRequirementHandled}
        onRefreshFacts={() => {
          void data.refresh();
          pool.refresh?.();
        }}
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

  if (view === 'responses') {
    return (
      <ResponsesBoard
        state={applicationsTracker}
        onOpenVacancies={() => onNavigate('opportunities')}
        initialStageFilter={navigationOptions?.stage}
        initialArchiveOpen={navigationOptions?.openArchive}
        onOpenExpert={onOpenExpert}
      />
    );
  }
  return (
    <VacanciesPoolScreen
      pool={pool}
      subscriptions={data.snapshot?.vacancySubscriptions}
      onRefreshSubscriptions={data.refresh}
      applications={vacancyApplications}
      archivedApplicationClusterIds={archivedApplicationClusterIds}
      onMarkAlreadyApplied={onMarkAlreadyApplied}
      onScheduleInterview={onScheduleInterview}
      onOpenResponses={() => onNavigate('responses')}
      onOpenArchive={() => onNavigate('responses', { openArchive: true })}
      onOpenProfile={onOpenProfileRequirement}
      onOpenExpert={onOpenExpert}
      pathIndicator={pathIndicatorSteps ? { steps: pathIndicatorSteps, onNavigate } : undefined}
      premises={routePremisesDraft({
        workspace,
        account: data.account,
        visibleTargetRole: targetDirection,
      })}
      premisesLoading={data.loading}
      onSavePremises={onSavePremises}
      focusRoleFilter={view === 'career' || Boolean(navigationOptions?.focusRoleFilter || navigationOptions?.focusFilter === 'role')}
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
  loadingMessage,
  error,
  onRetry,
  onAskConsultant,
  tabs,
}: {
  view: CareerCabinetView;
  loading: boolean;
  loadingMessage?: string;
  error?: string;
  onRetry: () => void;
  onAskConsultant?: () => void;
  /** «Профиль / Документ и форматы» — only the profile view sends one. */
  tabs?: ReactNode;
}) {
  return (
    <PageHeader
      kicker={VIEW_KICKER[view]}
      title={VIEW_TITLE[view]}
      description={VIEW_DESCRIPTION[view]}
      onAskConsultant={onAskConsultant}
      right={
        <CabinetHeaderState
          tabs={tabs}
          loading={loading}
          loadingMessage={loadingMessage}
          error={error}
          onRetry={onRetry}
        />
      }
    />
  );
}

function CabinetHeaderState({
  tabs,
  loading,
  loadingMessage,
  error,
  onRetry,
}: {
  tabs?: ReactNode;
  loading: boolean;
  loadingMessage?: string;
  error?: string;
  onRetry: () => void;
}) {
  if (!tabs && !loading && !error) return undefined;
  return (
    <>
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
            <span className="is-loading">{loadingMessage ?? 'Обновляем…'}</span>
          )}
        </div>
      ) : null}
    </>
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

const VIEW_KICKER: Record<CareerCabinetView, string> = {
  today: 'Личный кабинет',
  profile: 'Личный кабинет',
  resume: 'Личный кабинет',
  career: 'Кампания',
  opportunities: 'Кампания',
  responses: 'Отклики в работе',
};

// Шапка раздела говорит, что человек здесь получит, а не как устроен модуль
// (B236, отчёты маркетолога и консультанта): без «пула», «выборок», «маршрута».
const VIEW_DESCRIPTION: Record<CareerCabinetView, string> = {
  today: 'Поиск работы с опорой на проверенные факты и один шаг на сегодня.',
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
    .filter(
      (application) =>
        application.nearestInterview?.scheduledAt && !isClosedApplicationStage(application.stage),
    )
    .sort((a, b) =>
      (a.nearestInterview?.scheduledAt as string).localeCompare(
        b.nearestInterview?.scheduledAt as string,
      ),
    );
  const nearest = withInterview[0];
  if (!nearest?.nearestInterview?.scheduledAt) return null;
  return {
    company: nearest.vacancy?.companyHidden
      ? 'Компания скрыта'
      : nearest.vacancy?.company || 'Компания не указана',
    scheduledAt: nearest.nearestInterview.scheduledAt,
  };
}
