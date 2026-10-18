import type { Page, Route } from '@playwright/test';
import { installBlockAFootprintFixture } from './block-a-footprint-fixture';
import { mockSignedInCabinet } from '../../e2e/fixtures/mockSignedInCabinet';
import { candidateSnapshot as baseCandidateSnapshot } from '../../e2e/fixtures/readabilityWorkspace';
import type {
  CandidateMemory,
  CandidateSnapshot,
  CareerCommand,
} from '../../src/features/coach/coachApi';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../../server/domain/resumeDraft';
import { buildResumeStudioProjection } from '../../server/domain/resumeStudio';
import {
  formatResumeAsAtsText,
  formatTargetedResumeAsAtsText,
} from '../../server/domain/resumeAtsText';
import {
  buildResumeAtsAssessment,
  type ResumeAtsAssessment,
} from '../../server/domain/resumeAtsAssessment';
import { buildTargetedResumeSlice } from '../../server/domain/resumeStudioTargeted';
import { estimateResumePages } from '../../server/domain/resumeTargetedVolume';
import type { StoredResumeVersion } from '../../server/domain/resumeVersions';
import type {
  MomentumMetricEvidence,
  MomentumMetrics,
  MomentumWindowEvidence,
  SearchMomentum,
  TodayQueueItem,
  TodaySnapshot,
} from '../../src/features/today/todayApi';
import type { ResumeAtsAssessmentRequest } from '../../src/features/resume/resumeVersionsApi';

const CANDIDATE_ID = 'block-a-visual-andrei';
const AS_OF = '2026-10-07T06:12:00.000Z';
const CREATED_AT = '2026-10-01T12:00:00.000Z';
const SOURCE_MESSAGE_ID = 'block-a-synthetic-profile-source';
const REQUEST_ID = 'block-a-visual-fixture';
const QUEUE_REVISION = 'block-a-queue-2026-10-07';
const TEAM_SIZE_ID = 'block-a-memory-team-size-proposal';
const MARKETING_DATE_ID = 'block-a-memory-marketing-date-proposal';

type MemoryRow = readonly [
  id: string,
  domain: CandidateMemory['domain'],
  statement: string,
  status?: CandidateMemory['status'],
  confidence?: CandidateMemory['confidence'],
];

function makeMemory([
  id,
  domain,
  statement,
  status = 'confirmed',
  confidence = status === 'proposed' ? 'coach-hypothesis' : 'candidate-reported',
]: MemoryRow): CandidateMemory {
  return {
    id,
    kind: 'fact',
    domain,
    statement,
    status,
    confidence,
    sourceMessageIds: [SOURCE_MESSAGE_ID],
    sensitive: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

/** Synthetic evidence for a local visual sample; no external account or provider is read. */
// prettier-ignore
export const syntheticResumeMemory: readonly CandidateMemory[] = ([
  ['block-a-memory-fintech-role', 'role-evidence', 'Head of Engineering в «Финтех Лаб» с 03.2021 по настоящее время; размер команды неизвестен.'],
  // Independently scoped synthetic description from the approved mobile Fintech editor.
  ['block-a-memory-fintech-description', 'responsibility', 'Руководил разработкой B2B-платформы, 4 команды.'],
  ['block-a-memory-fintech-outcome-1', 'outcome', 'Выстроил две платёжные команды и антифрод, всего 3 направления.', 'confirmed', 'candidate-confirmed'],
  ['block-a-memory-fintech-outcome-2', 'outcome', 'Перевёл ядро платежей на сервисную архитектуру.', 'confirmed', 'candidate-confirmed'],
  ['block-a-memory-fintech-outcome-3', 'outcome', 'Снизил время вывода релиза с 14 до 3 дней.', 'confirmed', 'candidate-confirmed'],
  ['block-a-memory-marketing-role', 'role-evidence', 'Директор по разработке в «Маркет Софт», 09.2017 — 02.2021; даты ожидают уточнения.'],
  ['block-a-memory-marketing-description', 'responsibility', 'Руководил разработкой B2B-платформы, 4 команды, бюджет разработки.'],
  ['block-a-memory-marketing-achievement', 'outcome', 'Вырос от тимлида до директора, команда 40 человек.'],
  ['block-a-memory-retail-role', 'role-evidence', 'Тимлид в «Ритейл Системс», 06.2013 — 08.2017.'],
  ['block-a-memory-education', 'other', 'МГТУ им. Баумана, информатика и системы управления, 2008 — 2013.'],
  ['block-a-memory-russian', 'other', 'Русский язык — родной.'],
  ['block-a-memory-english', 'other', 'Английский язык — уровень C1.'],
  ['block-a-memory-project', 'responsibility', 'Руководитель проекта «Антифрод-платформа» в «Финтех Лаб».'],
  [TEAM_SIZE_ID, 'responsibility', 'Размер команды «Финтех Лаб» — 38 человек. Предложение ждёт подтверждения кандидата.', 'proposed'],
  [MARKETING_DATE_ID, 'role-evidence', 'Дата окончания работы в «Маркет Софт» — 01.2021. Предложение ждёт подтверждения кандидата.', 'proposed'],
  ['block-a-memory-kafka-proposal', 'skill', 'Навык Kafka ожидает подтверждения кандидата.', 'proposed'],
  ['block-a-memory-kubernetes-proposal', 'skill', 'Навык Kubernetes ожидает подтверждения кандидата.', 'proposed'],
] as const).map(makeMemory);

const skillNames = [
  'Engineering management',
  'Платёжные системы',
  'Kafka',
  'Kubernetes',
  'PostgreSQL',
  'Найм руководителей',
] as const;

/** Matches the approved profile sample and remains 8 of 11 blocks complete. */
export const syntheticResumeDraft: ResumeDraft = {
  ...EMPTY_RESUME_DRAFT,
  schemaVersion: 2,
  candidate: {
    fullName: 'Андрей Лебедев',
    headline: 'Head of Engineering',
    about:
      'Руковожу инженерией финтех-платформ: команды платежей и антифрода, переход на сервисную архитектуру, найм руководителей направлений. До этого десять лет строил разработку в ритейле и B2B: от складской логистики до платформы для маркетплейсов. Сильная сторона: превращаю разрозненные команды в предсказуемые поставки, с понятными метриками и без героизма. Ищу роль CTO или директора по инжинирингу в продуктовой финтех-компании.',
    contact: { location: 'Москва', links: [] },
  },
  targetRole: 'CTO',
  experience: [
    {
      id: 'block-a-experience-fintech',
      chronologyMemoryId: 'block-a-memory-fintech-role',
      descriptionMemoryId: 'block-a-memory-fintech-description',
      title: 'Head of Engineering',
      employer: 'Финтех Лаб',
      location: 'Москва',
      startDate: '2021-03',
      current: true,
      workplaceType: 'hybrid',
      bulletMemoryIds: [
        'block-a-memory-fintech-outcome-1',
        'block-a-memory-fintech-outcome-2',
        'block-a-memory-fintech-outcome-3',
      ],
      skills: skillNames.slice(0, 6),
    },
    {
      id: 'block-a-experience-marketing',
      chronologyMemoryId: 'block-a-memory-marketing-role',
      title: 'Директор по разработке',
      employer: 'Маркет Софт',
      startDate: '2017-09',
      endDate: '2021-02',
      current: false,
      // Keep this desktop assertion separate from the independently scoped mobile Fintech description; neither is real candidate data.
      descriptionMemoryId: 'block-a-memory-marketing-description',
      bulletMemoryIds: ['block-a-memory-marketing-achievement'],
    },
    {
      id: 'block-a-experience-retail',
      chronologyMemoryId: 'block-a-memory-retail-role',
      title: 'Тимлид',
      employer: 'Ритейл Системс',
      startDate: '2013-06',
      endDate: '2017-08',
      current: false,
      bulletMemoryIds: [],
    },
  ],
  skills: skillNames.map((name, index) => ({
    id: 'block-a-skill-' + String(index + 1).padStart(2, '0'),
    name,
    ...(name === 'Kafka' || name === 'Kubernetes'
      ? { status: 'awaiting_candidate_confirmation', source: 'synthetic_fixture' }
      : {}),
  })),
  education: [
    {
      id: 'block-a-education-1',
      evidenceMemoryId: 'block-a-memory-education',
      institution: 'МГТУ им. Баумана',
      qualification: 'Информатика и системы управления · специалист',
      startDate: '2008',
      endDate: '2013',
    },
  ],
  projects: [
    {
      id: 'block-a-project-antifraud',
      evidenceMemoryId: 'block-a-memory-project',
      name: 'Антифрод-платформа',
      startDate: '2022-01',
      endDate: '2023-11',
      employer: 'Финтех Лаб',
      description: 'Руководитель проекта',
    },
  ],
  languages: [
    {
      id: 'block-a-language-ru',
      evidenceMemoryId: 'block-a-memory-russian',
      name: 'Русский',
      sourceLabel: 'родной',
    },
    {
      id: 'block-a-language-en',
      evidenceMemoryId: 'block-a-memory-english',
      name: 'Английский',
      cefr: 'C1',
      sourceLabel: 'свободный, C1',
    },
  ],
  achievements: [
    {
      id: 'block-a-achievement-delivery-time',
      evidenceMemoryId: 'block-a-memory-fintech-outcome-3',
      kind: 'organization',
      title: 'Снизил время вывода релиза с 14 до 3 дней.',
    },
  ],
  courses: [],
  certifications: [],
  recommendations: [],
};

type StudioResponse = {
  readonly draft: ResumeDraft;
  readonly savedAt: { readonly createdAt: string; readonly updatedAt: string };
  readonly projection: ReturnType<typeof buildResumeStudioProjection>;
  readonly evidenceFreshness: { readonly valid: boolean; readonly stale: readonly [] };
  readonly reader: null;
};
type VersionList = {
  readonly items: readonly Omit<StoredResumeVersion, 'snapshot'>[];
  readonly nextCursor: null;
  readonly totalCount: number;
  readonly currentMasterRevision: string;
};
type FixtureState = {
  currentDraft: ResumeDraft;
  currentMemory: CandidateMemory[];
  resumeUpdatedAt: string;
  masterRevision: number;
  commands: CareerCommand[];
  versions: Map<string, StoredResumeVersion>;
};

function cloneMemory(items: readonly CandidateMemory[]): CandidateMemory[] {
  return [...structuredClone(items)];
}

function buildCandidateSnapshot(state: FixtureState): CandidateSnapshot {
  const base = structuredClone(baseCandidateSnapshot);
  return {
    ...base,
    importedSources: [
      {
        platform: 'linkedin',
        connectedAt: '2026-09-12T09:00:00.000Z',
        lastImportedAt: '2026-09-12T09:00:00.000Z',
        factCount: 9,
      },
      {
        platform: 'hh',
        connectedAt: '2026-10-07T09:00:00.000Z',
        lastImportedAt: '2026-10-07T09:00:00.000Z',
        factCount: 8,
      },
    ],
    candidate: { ...base.candidate, id: CANDIDATE_ID, dataClass: 'synthetic', locale: 'ru-RU' },
    messages: [
      {
        id: SOURCE_MESSAGE_ID,
        role: 'user',
        content: 'Синтетические данные локальной визуальной фикстуры.',
      },
    ],
    memory: cloneMemory(state.currentMemory),
    turns: [],
    dossier: {
      sections: [],
      confirmedCount: state.currentMemory.filter((item) => item.status === 'confirmed').length,
      proposedCount: state.currentMemory.filter((item) => item.status === 'proposed').length,
      readiness: { complete: false, unresolvedQuestions: 2, checks: [] },
    },
    assessments: [],
    germanyMarket: null,
    resume: {
      draft: structuredClone(state.currentDraft),
      createdAt: CREATED_AT,
      updatedAt: state.resumeUpdatedAt,
    },
    documents: [],
    vacancySubscriptions: [],
  };
}

function buildStudioResponse(state: FixtureState): StudioResponse {
  const projection = buildResumeStudioProjection({
    ...state.currentDraft,
    evidence: state.currentMemory,
  });
  return {
    draft: structuredClone(state.currentDraft),
    savedAt: { createdAt: CREATED_AT, updatedAt: state.resumeUpdatedAt },
    projection,
    evidenceFreshness: { valid: true, stale: [] },
    reader: null,
  };
}

function masterRevision(state: FixtureState): string {
  return 'block-a-master-revision-' + state.masterRevision;
}

function makeStoredVersion(
  state: FixtureState,
  id: string,
  title: string,
  requirements: readonly string[],
  status: StoredResumeVersion['status'],
): StoredResumeVersion {
  const projection = buildResumeStudioProjection({
    ...state.currentDraft,
    evidence: state.currentMemory,
  });
  const snapshot = estimateResumePages(
    buildTargetedResumeSlice(projection.master, { title, requirements }),
  );
  return {
    id,
    title,
    requirements,
    status,
    snapshot,
    revision: 1,
    sourceMasterRevision: masterRevision(state),
    createdAt: AS_OF,
    updatedAt: AS_OF,
  };
}

function suggestionCommand(
  commandId: string,
  objective: string,
  experienceId: string,
  memoryId: string,
  currentText: string,
  proposedText: string,
): CareerCommand {
  const proposal: CareerCommand['proposal'] = {
    kind: 'resume.revise',
    objective,
    evidenceRefs: ['memory:' + memoryId],
    acceptanceCriteria: ['Кандидат подтверждает содержание до сохранения в резюме.'],
    expectedSignal: 'Подтверждённая правка профиля',
    measureAfter: '2026-10-07',
    risk: 'candidate_data_write',
    resumeRevision: { section: 'experience', experienceId, memoryId, proposedText },
  };
  return {
    commandId,
    capability: 'resume.revise',
    status: 'awaiting_approval',
    proposal,
    executionTarget: {
      targetType: 'resume_block',
      section: 'experience',
      experienceId,
      memoryId,
      currentText,
      proposedText,
    },
    execution: null,
  };
}

export function createCommands(): CareerCommand[] {
  const team = suggestionCommand(
    'block-a-command-team-size',
    'Уточнить размер команды в «Финтех Лаб».',
    'block-a-experience-fintech',
    'block-a-memory-fintech-outcome-1',
    'Выстроил две платёжные команды и антифрод, всего 3 направления.',
    'Выстроил две платёжные команды и антифрод, всего 3 направления; команда — 38 человек.',
  );
  team.proposal = {
    ...team.proposal,
    evidenceRefs: [...team.proposal.evidenceRefs, `memory:${TEAM_SIZE_ID}`],
  };
  const dates = suggestionCommand(
    'block-a-command-marketing-dates',
    'Уточнить дату окончания работы в «Маркет Софт».',
    'block-a-experience-marketing',
    MARKETING_DATE_ID,
    '2021-02',
    '2021-01',
  );
  dates.proposal = {
    ...dates.proposal,
    resumeRevision: {
      section: 'experience',
      experienceId: 'block-a-experience-marketing',
      memoryId: null,
      field: 'endDate',
      proposedText: '2021-01',
    },
  };
  dates.executionTarget = { ...dates.executionTarget, memoryId: undefined, field: 'endDate' };
  return [team, dates];
}

function metricEvidence(
  source: MomentumMetricEvidence['source'],
  sampleSize: number,
  unknownReason?: string,
): MomentumMetricEvidence {
  return { source, sampleSize, ...(unknownReason ? { unknownReason } : {}) };
}

function momentumWindow(
  startAt: string,
  applied: number,
  interviews: number,
): MomentumWindowEvidence {
  const unknown = metricEvidence(
    'unavailable',
    0,
    'В локальной фикстуре нет проверенного источника для этой метрики.',
  );
  return {
    startAt,
    endAt: AS_OF,
    applied: metricEvidence('application_events.recorded_at', applied),
    views: unknown,
    screenings: unknown,
    interviews: metricEvidence('candidate_interview_schedules.scheduled_at', interviews),
  };
}

function buildMomentum(): SearchMomentum {
  const metrics = (applied: number, interviews: number): MomentumMetrics => ({
    applied,
    views: 'unknown',
    screenings: 'unknown',
    interviews,
  });
  return {
    calculatedAt: AS_OF,
    windows: { '7d': metrics(2, 1), '30d': metrics(7, 2) },
    evidence: {
      '7d': momentumWindow('2026-09-30T06:12:00.000Z', 2, 1),
      '30d': momentumWindow('2026-09-07T06:12:00.000Z', 7, 2),
    },
    burnoutNotice: false,
  };
}

function buildQueue(): TodayQueueItem[] {
  return [
    {
      kind: 'follow_up',
      applicationId: 'block-a-application-vector-follow-up',
      title: 'Напомнить Марии Орловой про итог интервью',
      company: 'Вектор Банк',
      eyebrow: 'Ответа нет 6 дней',
      dueAt: '2026-10-02T12:00:00.000Z',
      fit: null,
    },
    {
      kind: 'interview',
      applicationId: 'block-a-application-arka-interview',
      title: 'Подготовиться к интервью',
      company: 'Арка Холдинг',
      eyebrow: 'Вопрос о кризисе в команде',
      dueAt: '2026-10-10T06:00:00.000Z',
      fit: null,
    },
    {
      kind: 'candidate_turn',
      applicationId: 'block-a-application-greencode-draft',
      title: 'Одобрить письмо в «Гринкод»',
      company: 'Гринкод',
      eyebrow: 'Черновик, ничего не отправлено',
      dueAt: null,
      fit: null,
    },
    {
      kind: 'candidate_turn',
      applicationId: 'block-a-application-linkedin-post',
      title: 'Одобрить пост о миграции платформы',
      company: 'LinkedIn',
      eyebrow: 'Сам не опубликуется',
      dueAt: null,
      fit: null,
    },
  ];
}

function buildTodaySnapshot(queue: readonly TodayQueueItem[]): TodaySnapshot {
  const nextInterview = {
    company: 'Арка Холдинг',
    title: 'Head of Engineering',
    round: 2,
    at: '2026-10-10T06:00:00.000Z',
  };
  return {
    digest: {
      waitingForYou: 3,
      newVacancies: 14,
      followUpsDueToday: 0,
      followUpsOverdue: 1,
      closedVacancies: 0,
      interviewsAhead: 1,
      nextInterview,
      newVacanciesCaption: {
        campaignRole: 'Head of Engineering',
        sourcesCount: 0,
        updatedAt: AS_OF,
      },
      followUpCaptions: ['Вектор Банк · ответа нет 6 дней'],
      applicationsWaitingOver7Days: 1,
    },
    queue,
    queueTotal: queue.length,
    queueRevision: QUEUE_REVISION,
    queueOffset: 0,
    followUps: [
      {
        applicationId: 'block-a-application-vector-follow-up',
        company: 'Вектор Банк',
        title: 'Напомнить Марии Орловой про итог интервью',
        status: 'overdue',
      },
    ],
    sinceLastVisit: {
      since: '2026-10-05T15:40:00.000Z',
      items: ['14 новых вакансий по целевой роли'],
      newVacanciesCount: 14,
      applicationsWaitingOver7Days: 1,
      nearestInterview: nextInterview,
    },
    vacanciesPending: false,
    momentum: buildMomentum(),
  };
}

function fixtureState(): FixtureState {
  const state: FixtureState = {
    currentDraft: structuredClone(syntheticResumeDraft),
    currentMemory: cloneMemory(syntheticResumeMemory),
    resumeUpdatedAt: AS_OF,
    masterRevision: 1,
    commands: createCommands(),
    versions: new Map(),
  };
  state.versions.set(
    'block-a-resume-version-vector-bank',
    makeStoredVersion(
      state,
      'block-a-resume-version-vector-bank',
      'Под вакансию «Вектор Банк»',
      ['Kafka', 'Kubernetes', 'руководство инженерной командой'],
      'approved',
    ),
  );
  state.versions.set(
    'block-a-resume-version-greencode',
    makeStoredVersion(
      state,
      'block-a-resume-version-greencode',
      'Под вакансию «Гринкод»',
      ['сервисная архитектура', 'финтех', 'руководство командой'],
      'draft',
    ),
  );
  return state;
}

function apiError(route: Route, status: number, code: string, message: string) {
  return route.fulfill({
    status,
    json: { error: { code, message, retryable: false }, meta: { requestId: REQUEST_ID } },
  });
}

function apiData(route: Route, data: unknown, status = 200, meta: Record<string, unknown> = {}) {
  return route.fulfill({ status, json: { data, meta: { requestId: REQUEST_ID, ...meta } } });
}

function currentVersions(state: FixtureState): VersionList {
  const items = [...state.versions.values()]
    .map(({ snapshot: _snapshot, ...summary }) => summary)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    items,
    nextCursor: null,
    totalCount: items.length,
    currentMasterRevision: masterRevision(state),
  };
}

function buildAssessment(
  state: FixtureState,
  input: ResumeAtsAssessmentRequest,
): ResumeAtsAssessment | null {
  const version = input.versionId ? state.versions.get(input.versionId) : undefined;
  if (input.versionId && !version) return null;
  const projection = buildResumeStudioProjection({
    ...state.currentDraft,
    evidence: state.currentMemory,
  });
  const document = version?.snapshot.document ?? projection.master;
  const requirements = version?.requirements ?? input.requirements ?? [];
  const requirementSource = version
    ? {
        kind: 'saved_vacancy' as const,
        sourceId: version.id,
        label: version.title,
        capturedAt: version.createdAt,
      }
    : requirements.length
      ? {
          kind: 'candidate_input' as const,
          label: input.title?.trim() || 'Требования, указанные кандидатом',
          capturedAt: AS_OF,
        }
      : null;
  return buildResumeAtsAssessment({
    document,
    atsText: version
      ? formatTargetedResumeAsAtsText(version.snapshot)
      : formatResumeAsAtsText(document, state.currentDraft),
    requirements,
    requirementSource,
    resumeUpdatedAt: version?.updatedAt ?? state.resumeUpdatedAt,
    resumeSourceRevision: version?.sourceMasterRevision ?? masterRevision(state),
    evaluatedAt: AS_OF,
  });
}

async function routeTodayRead(route: Route, state: FixtureState, url: URL): Promise<boolean> {
  const path = url.pathname;
  const method = route.request().method();
  if (path === '/api/v1/candidate/me' && method === 'GET') {
    await apiData(route, buildCandidateSnapshot(state), 200, {
      memory: { nextOffset: null },
      turns: { nextOffset: null },
    });
    return true;
  }
  if (path === '/api/v1/candidate/me/memory' && method === 'GET') {
    await apiData(route, [], 200, { nextOffset: null });
    return true;
  }
  if (path === '/api/v1/candidate/today' && method === 'GET') {
    await routeTodaySnapshot(route, url);
    return true;
  }
  return false;
}

async function routeTodaySnapshot(route: Route, url: URL): Promise<void> {
  const queue = buildQueue();
  const requestedOffset = Number(url.searchParams.get('queueOffset') ?? '0');
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  const revision = url.searchParams.get('queueRevision');
  if (revision && revision !== QUEUE_REVISION) {
    await apiError(route, 409, 'today_queue_changed', 'Очередь обновилась. Загрузите её ещё раз.');
    return;
  }
  if (offset > 0 || revision) {
    await apiData(route, {
      queue: queue.slice(offset),
      queueTotal: queue.length,
      queueRevision: QUEUE_REVISION,
      queueOffset: offset,
    });
    return;
  }
  await apiData(route, buildTodaySnapshot(queue));
}

async function routeCareerCommands(
  route: Route,
  state: FixtureState,
  path: string,
): Promise<boolean> {
  if (path !== '/api/v1/candidate/career-commands' || route.request().method() !== 'GET')
    return false;
  await apiData(route, state.commands);
  return true;
}

async function routeResumeVersionsAndAssessment(
  route: Route,
  state: FixtureState,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === '/api/v1/candidate/resume/versions' && method === 'GET') {
    await apiData(route, currentVersions(state));
    return true;
  }
  const prefix = '/api/v1/candidate/resume/versions/';
  if (path.startsWith(prefix) && method === 'GET') {
    const version = state.versions.get(decodeURIComponent(path.slice(prefix.length)));
    if (!version) {
      await apiError(route, 404, 'resume_version_not_found', 'Версия резюме не найдена.');
      return true;
    }
    await apiData(route, { version, currentMasterRevision: masterRevision(state) });
    return true;
  }
  if (path === '/api/v1/candidate/resume/ats-assessment' && method === 'POST') {
    const assessment = buildAssessment(
      state,
      route.request().postDataJSON() as ResumeAtsAssessmentRequest,
    );
    if (!assessment) {
      await apiError(route, 404, 'resume_version_not_found', 'Версия резюме не найдена.');
      return true;
    }
    await apiData(route, { assessment });
    return true;
  }
  return false;
}

async function routeResumeRequest(
  route: Route,
  state: FixtureState,
  path: string,
): Promise<boolean> {
  const method = route.request().method();
  if (path === '/api/v1/candidate/resume') {
    if (method === 'GET') {
      await apiData(route, buildStudioResponse(state));
      return true;
    }
    if (method === 'PUT') {
      const input = route.request().postDataJSON() as ResumeDraft;
      if (!input || input.schemaVersion !== 2) {
        await apiError(
          route,
          409,
          'resume_client_outdated',
          'Обновите приложение, чтобы сохранить резюме.',
        );
        return true;
      }
      state.currentDraft = structuredClone(input);
      state.masterRevision += 1;
      state.resumeUpdatedAt = AS_OF;
      await apiData(route, buildStudioResponse(state));
      return true;
    }
  }
  return routeResumeVersionsAndAssessment(route, state, path, method);
}

async function routeCandidateRequest(route: Route, state: FixtureState): Promise<void> {
  const url = new URL(route.request().url());
  const path = url.pathname;
  if (await routeTodayRead(route, state, url)) return;
  if (await routeCareerCommands(route, state, path)) return;
  if (await routeResumeRequest(route, state, path)) return;
  await route.fallback();
}

/**
 * Installs the signed-in test cabinet, then adds candidate-scoped synthetic
 * HTTP responses for the approved Today and Profile visual sample.
 */
export async function installBlockAVisualFixture(page: Page): Promise<void> {
  await mockSignedInCabinet(page, {
    candidateId: CANDIDATE_ID,
    freezeNow: true,
    accountConnections: [],
  });
  await page.clock.setFixedTime(AS_OF);
  const state = fixtureState();
  await page.route('**/api/v1/candidate/**', (route) => routeCandidateRequest(route, state));
  await installBlockAFootprintFixture(page, CANDIDATE_ID);
}
