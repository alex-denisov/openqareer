import {
  completeCandidateAnalysis,
  createCandidateAnalysis,
  buildRoleHypotheses,
  type EvidenceItem,
  type RoleFitState,
} from '../evidence/evidenceEngine';
import { buildRoleMarketMap } from '../career-map/roleMarketMap';
import {
  candidateRegionLabel,
  normalizeCandidateRegions,
} from '../workspace/candidateRegions';
import {
  buildReasonedCareerAction,
  type ReasonedCareerAction,
} from '../next-action/careerActionPolicy';
import {
  applyCanonicalProfileEvidence,
  buildCareerDiagnostic,
  type CanonicalProfileMemory,
  type CareerDiagnostic,
} from '../diagnostic/careerDiagnostic';
import { recommendNextAction } from '../outcome/outcomeEngine';
import {
  createWorkspace,
  type CareerGoal,
  type CandidateWorkspace,
  type WorkspaceInput,
} from '../workspace/workspaceStorage';

const CAREER_JOURNEY_REVISION = 'career-journey-v1-2026-08-07' as const;

export type CareerJourneyDestination = 'today' | 'profile' | 'career' | 'opportunities';

interface CareerJourneyProfile {
  state: 'forming' | 'needs-review' | 'grounded';
  confirmedEvidence: number;
  proposedEvidence: number;
  importantUnknowns: string[];
  sourceLabel: string;
}

interface CareerJourneyRole {
  id: string;
  title: string;
  fitState: RoleFitState;
  basis: string;
  evidenceCount: number;
  gaps: string[];
}

interface CareerJourneyMarket {
  id: string;
  label: string;
  state: 'needs-sample' | 'sample-ready';
  explanation: string;
}

interface CareerTrackItem {
  id: 'career-picture' | 'role-market' | 'positioning' | 'campaign';
  label: string;
  status: 'complete' | 'active' | 'waiting';
  reason: string;
}

interface CareerJourneyAction {
  id: string;
  label: string;
  headline: string;
  reason: string;
  expectedChange: string;
  destination: CareerJourneyDestination;
}

interface CareerCommercialBoundary {
  state: 'free-route-incomplete' | 'assisted-setup-eligible';
  eligiblePlan: 'free' | 'setup';
  headline: string;
  reason: string;
}

export interface CareerJourney {
  revision: typeof CAREER_JOURNEY_REVISION;
  generatedAt: string;
  profile: CareerJourneyProfile;
  roles: CareerJourneyRole[];
  markets: CareerJourneyMarket[];
  diagnostic: CareerDiagnostic;
  track: CareerTrackItem[];
  nextAction: CareerJourneyAction;
  reasonedAction?: ReasonedCareerAction;
  commercialBoundary: CareerCommercialBoundary;
}

export function prepareCareerWorkspace(
  input: WorkspaceInput,
  now: string = new Date().toISOString(),
  previous?: CandidateWorkspace,
): CandidateWorkspace {
  const workspace = createWorkspace(input, now, previous);
  const analysis = workspace.resumeText ? createCandidateAnalysis(workspace.resumeText) : undefined;

  return {
    ...workspace,
    analysis:
      analysis && workspace.targetDirection
        ? completeCandidateAnalysis(workspace.targetDirection, analysis, now)
        : analysis,
  };
}

/**
 * Two next actions the wizard's analysis and the canonical profile both reach
 * for. They live here so the canonical layer can tell a stale "review the
 * facts" apart from a live one instead of repeating its wording (B166).
 */
const COMPARE_MARKETS_ACTION = {
  id: 'compare-markets',
  label: 'Сравнить рынки',
  headline: 'Проверим роль на выбранных рынках',
  reason:
    'Опыт уже даёт рабочую гипотезу, но спрос и ограничения ещё не подтверждены свежей выборкой.',
  expectedChange: 'Появится основной рынок и условия для первой кампании.',
  destination: 'career',
} as const;

const ADD_RESULT_EVIDENCE_ACTION = {
  id: 'add-result-evidence',
  label: 'Добавить результат',
  headline: 'Добавим измеримый результат',
  reason:
    'Все найденные факты уже подтверждены, но для выбора уровня роли не хватает результата или масштаба ответственности.',
  expectedChange: 'Рабочие гипотезы ролей получат более надёжное основание.',
  destination: 'profile',
} as const;

export function buildCareerJourney(
  workspace: CandidateWorkspace,
  now: string = new Date().toISOString(),
): CareerJourney {
  const evidence = workspace.analysis?.evidenceItems ?? [];
  const confirmedEvidence = evidence.filter((item) => item.status === 'confirmed');
  const proposedEvidence = evidence.filter((item) => item.status === 'pending');
  const roles = (workspace.analysis?.roleHypotheses ?? []).map((role) => ({
    id: role.id,
    title: role.title,
    fitState: role.fitState,
    basis: role.basis,
    evidenceCount: role.evidenceIds.filter((id) => confirmedEvidence.some((item) => item.id === id))
      .length,
    gaps: role.gaps,
  }));
  const hasSource = workspace.resumeText.trim().length > 0;
  const hasGroundedRole = roles.some(
    (role) => role.fitState === 'plausible' && role.evidenceCount > 0,
  );
  const hasFreshMarketSample = isFreshMarketSample(workspace.marketSample, now);
  const hasActiveOutcome = Boolean(
    workspace.opportunity &&
    workspace.outcomes.some(
      (event) => event.opportunityId === workspace.opportunity?.id && event.undoneAt === undefined,
    ),
  );
  const outcomeNextAction =
    workspace.opportunity && hasActiveOutcome
      ? recommendNextAction(workspace.opportunity.id, workspace.outcomes, now)
      : undefined;
  const diagnostic = buildCareerDiagnostic(
    {
      resumeText: workspace.resumeText,
      resumeSource: hasSource ? workspace.resumeSource : 'conversation',
      targetDirection: workspace.targetDirection,
      analysis: workspace.analysis,
      marketEvidenceUpdatedAt: workspace.marketSample?.fetchedAt ?? null,
    },
    now,
  );

  if (!hasSource && roles.length === 0) {
    return {
      revision: CAREER_JOURNEY_REVISION,
      generatedAt: now,
      profile: {
        state: 'forming',
        confirmedEvidence: 0,
        proposedEvidence: 0,
        importantUnknowns: [
          'Какие задачи и результаты лучше всего описывают ваш опыт?',
          'Какой масштаб ответственности был у вас в последних ролях?',
        ],
        sourceLabel: 'Начато с карьерного вопроса',
      },
      roles: [],
      markets: marketRoutesFor(workspace, now),
      diagnostic,
      track: buildTrack(false, false, false),
      nextAction: firstActionFor(workspace.careerGoal),
      commercialBoundary: commercialBoundaryFor(false),
    };
  }

  return {
    revision: CAREER_JOURNEY_REVISION,
    generatedAt: now,
    profile: {
      state:
        confirmedEvidence.length >= 3
          ? 'grounded'
          : proposedEvidence.length > 0
            ? 'needs-review'
            : 'forming',
      confirmedEvidence: confirmedEvidence.length,
      proposedEvidence: proposedEvidence.length,
      importantUnknowns: workspace.analysis?.questions.slice(0, 3) ?? [],
      sourceLabel: sourceLabelFor(workspace),
    },
    roles,
    markets: marketRoutesFor(workspace, now),
    diagnostic,
    track: buildTrack(
      confirmedEvidence.length >= 3,
      hasGroundedRole,
      hasFreshMarketSample,
      Boolean(workspace.actionPackage),
    ),
    nextAction: outcomeNextAction
      ? {
          id: `outcome-${outcomeNextAction.code}`,
          label: 'Продолжить по факту',
          headline: outcomeNextAction.title,
          reason: outcomeNextAction.reason,
          expectedChange:
            'Следующее решение будет опираться на записанный исход этой возможности, а не на предположение об ответе работодателя.',
          destination: 'opportunities',
        }
      : workspace.actionPackage
        ? {
            id: 'execute-action-package',
            label: 'Открыть пакет действия',
            headline: 'Сделаем первый контакт по выбранной вакансии',
            reason:
              workspace.actionPackage.decisionChoice === 'apply'
                ? 'Решение откликнуться сохранено. Проверьте сообщение, факты и условия перед отправкой в официальном интерфейсе.'
                : 'Решение сначала найти контакт сохранено. Проверьте адресата, сообщение и подтверждённые факты перед отправкой.',
            expectedChange:
              'Подготовленное действие станет отправленным только после вашего явного шага на площадке; openqareer не отправляет его автоматически.',
            destination: 'opportunities',
          }
        : hasGroundedRole
          ? hasFreshMarketSample
            ? {
                id: 'review-opportunities',
                label: 'Сравнить вакансии',
                headline: 'Проверим рабочую роль на вакансиях',
                reason:
                  'Свежая выборка уже собрана. Теперь важно проверить повторяющиеся требования и выбрать первую реальную возможность.',
                expectedChange:
                  'Появится проверяемый маршрут: отклик, контакт, наблюдение или пропуск.',
                destination: 'opportunities',
              }
            : COMPARE_MARKETS_ACTION
          : proposedEvidence.length > 0
            ? {
                id: 'review-evidence',
                label: 'Проверить факты',
                headline: 'Подтвердите опорные факты',
                reason:
                  'Из источника извлечены утверждения, но кандидат ещё не подтвердил их точность.',
                expectedChange: 'Подтверждённые факты станут основанием для сравнения ролей.',
                destination: 'profile',
              }
            : ADD_RESULT_EVIDENCE_ACTION,
    commercialBoundary: commercialBoundaryFor(hasGroundedRole && hasFreshMarketSample),
  };
}

export function applyCanonicalProfileToJourney(
  journey: CareerJourney,
  memory: CanonicalProfileMemory[],
  targetDirection: string = '',
  now: string = new Date().toISOString(),
  constraints: string = '',
): CareerJourney {
  const profileEvidence = memory.filter((item) => item.kind !== 'open-question');
  const confirmedEvidence = profileEvidence.filter((item) => item.status !== 'proposed');
  const proposedEvidence = profileEvidence.filter((item) => item.status === 'proposed');
  const openQuestions = memory
    .filter((item) => item.kind === 'open-question' && item.status === 'proposed')
    .flatMap((item) => (item.statement?.trim() ? [item.statement.trim()] : []));
  const confirmedOutcomes = confirmedEvidence.filter((item) => item.domain === 'outcome');
  const roleMarketMap = buildCanonicalRoleMarketMap(journey, memory, targetDirection, now);
  const roles = roleMarketMap.roles.map((role) => ({
    id: role.id,
    title: role.title,
    fitState: role.fitState,
    basis: role.basis,
    evidenceCount: role.evidenceRefs.length,
    gaps: role.gaps,
  }));
  const roleGrounded = roles.some((role) => role.evidenceCount > 0);
  const marketGrounded = journey.markets.some((market) => market.state === 'sample-ready');
  const actionPackageReady = journey.track.some(
    (item) => item.id === 'campaign' && item.status === 'active',
  );
  const diagnostic = applyCanonicalProfileEvidence(journey.diagnostic, memory);
  const reasonedAction = buildReasonedCareerAction({
    diagnostic,
    roleMarketMap,
    constraints,
  });

  return {
    ...journey,
    profile: {
      state:
        confirmedEvidence.length >= 3 && confirmedOutcomes.length > 0
          ? 'grounded'
          : proposedEvidence.length > 0
            ? 'needs-review'
            : 'forming',
      confirmedEvidence: confirmedEvidence.length,
      proposedEvidence: proposedEvidence.length,
      importantUnknowns:
        openQuestions.length > 0 ? openQuestions.slice(0, 3) : journey.profile.importantUnknowns,
      sourceLabel: 'Диалог и канонический профиль',
    },
    roles,
    track: buildTrack(
      confirmedEvidence.length >= 3 && confirmedOutcomes.length > 0,
      roleGrounded,
      marketGrounded,
      actionPackageReady,
    ),
    diagnostic,
    reasonedAction,
    nextAction:
      proposedEvidence.length > 0
        ? {
            id: 'review-evidence',
            label: 'Проверить выводы',
            headline: 'Подтвердите опорные факты',
            reason: 'Диалог добавил выводы в профиль, но кандидат ещё не подтвердил их точность.',
            expectedChange:
              'Подтверждённые факты станут основанием для диагностики и сравнения ролей.',
            destination: 'profile',
          }
        : confirmedOutcomes.length === 0
          ? {
              id: 'add-result-evidence',
              label: 'Рассказать о результате',
              headline: 'Добавим наблюдаемый результат',
              reason:
                'В профиле есть подтверждённый контекст, но для диагностики уровня роли не хватает результата.',
              expectedChange:
                'Следующий ответ станет предложенным фактом с источником и потребует проверки.',
              destination: 'today',
            }
          : staleReviewFreeAction(journey.nextAction, roleGrounded),
  };
}

/**
 * The wizard's own analysis keeps calling its evidence pending forever, so once
 * the candidate has reviewed the dossier its "confirm the facts" step is a lie
 * the cabinet must not repeat (B166).
 */
function staleReviewFreeAction(
  action: CareerJourney['nextAction'],
  roleGrounded: boolean,
): CareerJourney['nextAction'] {
  if (action.id !== 'review-evidence') return action;
  return roleGrounded ? COMPARE_MARKETS_ACTION : ADD_RESULT_EVIDENCE_ACTION;
}

export function buildCanonicalProfileJourney(
  journey: CareerJourney | undefined,
  memory: CanonicalProfileMemory[],
  targetDirection: string = '',
  now: string = new Date().toISOString(),
  constraints: string = '',
): CareerJourney {
  const baseJourney =
    journey ??
    buildCareerJourney(
      createWorkspace(
        {
          resumeText: '',
          resumeSource: 'text',
          targetDirection,
          regions: ['ru'],
          currentSituation: 'Канонический профиль собран из защищённого диалога.',
          constraints: '',
          urgency: 'exploring',
        },
        now,
      ),
      now,
    );
  return applyCanonicalProfileToJourney(baseJourney, memory, targetDirection, now, constraints);
}

function buildCanonicalRoleMarketMap(
  journey: CareerJourney,
  memory: CanonicalProfileMemory[],
  targetDirection: string,
  now: string,
) {
  const evidence = memory.flatMap((item): EvidenceItem[] => {
    const statement = item.statement?.trim();
    if (
      !statement ||
      item.kind === 'open-question' ||
      ['preference', 'constraint', 'gap', 'other'].includes(item.domain)
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        kind:
          item.domain === 'outcome'
            ? 'result'
            : item.domain === 'responsibility'
              ? 'responsibility'
              : 'expertise',
        sourceExcerpt: statement,
        statement,
        status: item.status === 'proposed' ? 'pending' : 'confirmed',
        userEdited: item.status === 'corrected',
      },
    ];
  });
  const roles = buildRoleHypotheses(targetDirection, evidence);
  return buildRoleMarketMap(
    {
      roleHypotheses: roles,
      evidence,
      markets: journey.markets.map((market) => ({
        id: market.id,
        geography: market.id === 'russia' ? 'russia' : 'worldwide-remote',
        label: market.label,
        workMode: market.id === 'russia' ? 'hybrid' : 'remote',
        observations: [],
      })),
    },
    now,
  );
}

function commercialBoundaryFor(routeGrounded: boolean): CareerCommercialBoundary {
  return routeGrounded
    ? {
        state: 'assisted-setup-eligible',
        eligiblePlan: 'setup',
        headline: 'Можно подключить сопровождаемую настройку поиска',
        reason:
          'Рабочая роль опирается на подтверждённые факты и свежую рыночную выборку. Платная работа может экономить время на материалах и подготовке кампании, но не обещает интервью или оффер.',
      }
    : {
        state: 'free-route-incomplete',
        eligiblePlan: 'free',
        headline: 'Сначала завершим бесплатную проверку маршрута',
        reason:
          'До подтверждения роли и рынка openqareer не предлагает оплачивать настройку поиска.',
      };
}

function firstActionFor(goal: CareerGoal | undefined): CareerJourneyAction {
  if (goal === 'find-job') {
    return {
      id: 'inspect-job-search',
      label: 'Добавить резюме',
      headline: 'Сначала проверим основу поиска',
      reason: 'Первый шаг — отделить проблемы резюме и позиционирования от проблем роли и рынка.',
      expectedChange:
        'Резюме покажет проверяемые проблемы подачи; затем их можно будет сопоставить со свежими вакансиями.',
      destination: 'profile',
    };
  }
  if (goal === 'positioning') {
    return {
      id: 'inspect-positioning',
      label: 'Добавить резюме',
      headline: 'Сначала проверим позиционирование',
      reason: 'Без текста резюме нельзя отличить слабую подачу от нехватки доказательств опыта.',
      expectedChange: 'Появятся проверяемые проблемы документа и факты, которые нужно усилить.',
      destination: 'profile',
    };
  }
  if (goal === 'market') {
    return {
      id: 'clarify-market-constraints',
      label: 'Добавить опыт и ограничения',
      headline: 'Сначала зафиксируем рамки рынка',
      reason:
        'Сравнение стран и форматов работы зависит от опыта, географии и ограничений кандидата.',
      expectedChange:
        'Появится основание для сравнения рынков без обещаний по непроверенным условиям.',
      destination: 'profile',
    };
  }
  return {
    id: 'clarify-experience',
    label: 'Рассказать об опыте',
    headline: 'Сначала найдём опорные задачи',
    reason: 'Без примеров работы платформа не будет придумывать подходящие роли.',
    expectedChange: 'После ответа появятся первые проверяемые гипотезы о направлении.',
    destination: 'profile',
  };
}

function buildTrack(
  profileGrounded: boolean,
  roleGrounded: boolean,
  marketGrounded: boolean,
  actionPackageReady: boolean = false,
): CareerTrackItem[] {
  const routeGrounded = roleGrounded && marketGrounded;
  return [
    {
      id: 'career-picture',
      label: 'Карьерная картина',
      status: profileGrounded ? 'complete' : 'active',
      reason: profileGrounded
        ? 'Опорные факты подтверждены.'
        : 'Собираем опыт, предпочтения и ограничения.',
    },
    {
      id: 'role-market',
      label: 'Роль и рынок',
      status: routeGrounded ? 'complete' : roleGrounded ? 'active' : 'waiting',
      reason: routeGrounded
        ? 'Ролевая гипотеза проверена датированной рыночной выборкой.'
        : roleGrounded
          ? 'Есть рабочая ролевая гипотеза, рынок ещё не проверен.'
          : 'Нужны подтверждённые факты и рыночная выборка.',
    },
    {
      id: 'positioning',
      label: 'Позиционирование',
      status: routeGrounded ? (actionPackageReady ? 'complete' : 'active') : 'waiting',
      reason: actionPackageReady
        ? 'Позиционирование собрано из подтверждённых фактов для выбранной вакансии.'
        : 'Создаётся только после выбора рабочей роли и рынка.',
    },
    {
      id: 'campaign',
      label: 'Кампания поиска',
      status: actionPackageReady ? 'active' : 'waiting',
      reason: actionPackageReady
        ? 'Первое действие подготовлено и ждёт явной отправки кандидатом.'
        : 'Запускается после согласования роли, рынка и материалов.',
    },
  ];
}

/**
 * One route per region the candidate actually named.
 *
 * The wizard used to answer this with one flag, so the map always showed
 * exactly one route — «Россия» or «Международный рынок» — no matter where the
 * candidate was really looking (B158). An empty list is the honest state for a
 * candidate who has not chosen a region yet: inventing a default here would
 * put a market on the map that nobody asked for.
 */
function marketRoutesFor(workspace: CandidateWorkspace, now: string): CareerJourneyMarket[] {
  const sample = workspace.marketSample;
  const sampleIsFresh = isFreshMarketSample(sample, now);
  const sampleIsRecent = isRecentMarketSample(sample, now);
  return normalizeCandidateRegions(workspace.regions).map((region) =>
    region === 'ru'
      ? {
          id: region,
          label: candidateRegionLabel(region),
          state: sampleIsFresh ? 'sample-ready' : 'needs-sample',
          explanation:
            sampleIsFresh && sample
              ? `hh.ru: ${sample.items.length} вакансий из ${sample.found} найденных, с датой наблюдения.`
              : sample && !sampleIsRecent
                ? `Выборка hh.ru от ${sample.fetchedAt.slice(0, 10)} устарела. Нужна новая датированная проверка.`
                : sample
                  ? `В выборке только ${sample.items.length} релевантных вакансий. Для проверки маршрута нужно не менее 5.`
                  : 'Нужна свежая выборка вакансий по рабочей гипотезе роли.',
        }
      : {
          id: region,
          label: candidateRegionLabel(region),
          state: 'needs-sample',
          explanation: 'Нужно выбрать формат работы и проверить право на работу в регионе.',
        },
  );
}

function isFreshMarketSample(sample: CandidateWorkspace['marketSample'], now: string): boolean {
  return Boolean(sample && sample.items.length >= 5 && isRecentMarketSample(sample, now));
}

function isRecentMarketSample(sample: CandidateWorkspace['marketSample'], now: string): boolean {
  if (!sample) return false;
  const fetchedAt = new Date(sample.fetchedAt).valueOf();
  const generatedAt = new Date(now).valueOf();
  if (Number.isNaN(fetchedAt) || Number.isNaN(generatedAt)) return false;
  const age = generatedAt - fetchedAt;
  return age >= 0 && age <= 90 * 86_400_000;
}

function sourceLabelFor(workspace: CandidateWorkspace): string {
  if (workspace.resumeFileName) return workspace.resumeFileName;
  if (workspace.linkedinUrl && workspace.resumeText.trim()) return 'Профиль LinkedIn';
  if (workspace.hhUrl && workspace.resumeText.trim()) return 'Резюме hh.ru';
  if (workspace.resumeSource === 'linkedin-pdf') return 'Экспорт LinkedIn';
  if (workspace.resumeSource === 'hh-pdf') return 'Экспорт hh.ru';
  if (workspace.resumeSource === 'text') return 'Текст или диалог';
  return 'PDF-резюме';
}
