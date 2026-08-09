import {
  completeCandidateAnalysis,
  createCandidateAnalysis,
  type RoleFitState,
} from '../evidence/evidenceEngine';
import {
  buildCareerDiagnostic,
  type CareerDiagnostic,
} from '../diagnostic/careerDiagnostic';
import {
  createWorkspace,
  type CareerGoal,
  type CandidateWorkspace,
  type WorkspaceInput,
} from '../workspace/workspaceStorage';

export const CAREER_JOURNEY_REVISION =
  'career-journey-v1-2026-08-07' as const;

export type CareerJourneyDestination =
  | 'today'
  | 'profile'
  | 'career'
  | 'opportunities';

export interface CareerJourneyProfile {
  state: 'forming' | 'needs-review' | 'grounded';
  confirmedEvidence: number;
  proposedEvidence: number;
  importantUnknowns: string[];
  sourceLabel: string;
}

export interface CareerJourneyRole {
  id: string;
  title: string;
  fitState: RoleFitState;
  basis: string;
  evidenceCount: number;
  gaps: string[];
}

export interface CareerJourneyMarket {
  id: string;
  label: string;
  state: 'needs-sample' | 'sample-ready';
  explanation: string;
}

export interface CareerTrackItem {
  id: 'career-picture' | 'role-market' | 'positioning' | 'campaign';
  label: string;
  status: 'complete' | 'active' | 'waiting';
  reason: string;
}

export interface CareerJourneyAction {
  id: string;
  label: string;
  headline: string;
  reason: string;
  expectedChange: string;
  destination: CareerJourneyDestination;
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
}

export function prepareCareerWorkspace(
  input: WorkspaceInput,
  now: string = new Date().toISOString(),
  previous?: CandidateWorkspace,
): CandidateWorkspace {
  const workspace = createWorkspace(input, now, previous);
  const analysis = workspace.resumeText
    ? createCandidateAnalysis(workspace.resumeText)
    : undefined;

  return {
    ...workspace,
    analysis:
      analysis && workspace.targetDirection
        ? completeCandidateAnalysis(workspace.targetDirection, analysis, now)
        : analysis,
  };
}

export function buildCareerJourney(
  workspace: CandidateWorkspace,
  now: string = new Date().toISOString(),
): CareerJourney {
  const evidence = workspace.analysis?.evidenceItems ?? [];
  const confirmedEvidence = evidence.filter(
    (item) => item.status === 'confirmed',
  );
  const proposedEvidence = evidence.filter(
    (item) => item.status === 'pending',
  );
  const roles = (workspace.analysis?.roleHypotheses ?? []).map((role) => ({
    id: role.id,
    title: role.title,
    fitState: role.fitState,
    basis: role.basis,
    evidenceCount: role.evidenceIds.filter((id) =>
      confirmedEvidence.some((item) => item.id === id),
    ).length,
    gaps: role.gaps,
  }));
  const hasSource = workspace.resumeText.trim().length > 0;
  const hasGroundedRole = roles.some(
    (role) => role.fitState === 'plausible' && role.evidenceCount > 0,
  );
  const hasMarketSample = Boolean(workspace.marketSample);
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
      markets: marketRoutesFor(workspace),
      diagnostic,
      track: buildTrack(false, false),
      nextAction: firstActionFor(workspace.careerGoal),
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
    markets: marketRoutesFor(workspace),
    diagnostic,
    track: buildTrack(confirmedEvidence.length >= 3, hasGroundedRole),
    nextAction: hasGroundedRole
      ? hasMarketSample
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
        : {
          id: 'compare-markets',
          label: 'Сравнить рынки',
          headline: 'Проверим роль на выбранных рынках',
          reason:
            'Опыт уже даёт рабочую гипотезу, но спрос и ограничения ещё не подтверждены свежей выборкой.',
          expectedChange:
            'Появится основной рынок и условия для первой кампании.',
          destination: 'career',
          }
      : proposedEvidence.length > 0
        ? {
          id: 'review-evidence',
          label: 'Проверить факты',
          headline: 'Подтвердите опорные факты',
          reason:
            'Из источника извлечены утверждения, но кандидат ещё не подтвердил их точность.',
          expectedChange:
            'Подтверждённые факты станут основанием для сравнения ролей.',
          destination: 'profile',
          }
        : {
            id: 'add-result-evidence',
            label: 'Добавить результат',
            headline: 'Добавим измеримый результат',
            reason:
              'Все найденные факты уже подтверждены, но для выбора уровня роли не хватает результата или масштаба ответственности.',
            expectedChange:
              'Рабочие гипотезы ролей получат более надёжное основание.',
            destination: 'profile',
          },
  };
}

function firstActionFor(goal: CareerGoal | undefined): CareerJourneyAction {
  if (goal === 'find-job') {
    return {
      id: 'inspect-job-search',
      label: 'Добавить резюме',
      headline: 'Сначала проверим основу поиска',
      reason:
        'Первый шаг — отделить проблемы резюме и позиционирования от проблем роли и рынка.',
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
      reason:
        'Без текста резюме нельзя отличить слабую подачу от нехватки доказательств опыта.',
      expectedChange:
        'Появятся проверяемые проблемы документа и факты, которые нужно усилить.',
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
    reason:
      'Без примеров работы платформа не будет придумывать подходящие роли.',
    expectedChange:
      'После ответа появятся первые проверяемые гипотезы о направлении.',
    destination: 'profile',
  };
}

function buildTrack(
  profileGrounded: boolean,
  roleGrounded: boolean,
): CareerTrackItem[] {
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
      status: profileGrounded ? (roleGrounded ? 'complete' : 'active') : 'waiting',
      reason: roleGrounded
        ? 'Есть рабочая ролевая гипотеза.'
        : 'Нужны подтверждённые факты и рыночная выборка.',
    },
    {
      id: 'positioning',
      label: 'Позиционирование',
      status: roleGrounded ? 'active' : 'waiting',
      reason: 'Создаётся только после выбора рабочей роли и рынка.',
    },
    {
      id: 'campaign',
      label: 'Кампания поиска',
      status: 'waiting',
      reason: 'Запускается после согласования роли, рынка и материалов.',
    },
  ];
}

function marketRoutesFor(
  workspace: CandidateWorkspace,
): CareerJourneyMarket[] {
  const sample = workspace.marketSample;
  return [
    workspace.market === 'ru'
      ? {
          id: 'russia',
          label: 'Россия',
          state: sample ? 'sample-ready' : 'needs-sample',
          explanation: sample
            ? `hh.ru: ${sample.items.length} вакансий из ${sample.found} найденных, с датой наблюдения.`
            : 'Нужна свежая выборка вакансий по рабочей гипотезе роли.',
        }
      : {
          id: 'international',
          label: 'Международный рынок',
          state: 'needs-sample',
          explanation:
            'Нужно выбрать страны, формат работы и проверить право на работу.',
        },
  ];
}

function sourceLabelFor(workspace: CandidateWorkspace): string {
  if (workspace.resumeFileName) return workspace.resumeFileName;
  if (workspace.resumeSource === 'linkedin-pdf') return 'Экспорт LinkedIn';
  if (workspace.resumeSource === 'hh-pdf') return 'Экспорт hh.ru';
  if (workspace.resumeSource === 'text') return 'Текст или диалог';
  return 'PDF-резюме';
}
