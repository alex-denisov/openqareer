import type { Page, Route } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

/** Проверка навыков C04 для B653: прогон роли с разговором, предложениями и кейсами. */
const BASE = '**/api/v1/candidate/role-skill-assessments';
const AT = '2026-11-18T09:00:00.000Z';
const ROLE = 'Руководитель разработки';

type Grade = 'confirmed' | 'partial' | 'not_confirmed';

const ref = { id: 'ref-1', vacancyId: 'v1', observedAt: AT, sourceName: 'hh.ru' };

function skillCase(id: string, skillName: string, prompt: string) {
  return {
    assessmentCase: {
      id,
      roleId: 'role-1',
      requirementId: `req-${id}`,
      skillId: `skill-${id}`,
      skillName,
      prompt,
      requirementsCount: 12,
      sourceRefs: [ref],
    },
    status: 'pending' as 'pending' | 'answered' | 'skipped',
    answer: null as string | null,
    evaluation: null as unknown,
    evaluationHistory: [],
    decision: undefined as 'pending' | 'accepted' | 'declined' | undefined,
    appealReason: null,
    pendingDiscussionQuestion: null,
    discussion: [],
  };
}

export function evaluation(answer: string, grades: readonly Grade[]) {
  const names = [
    'Что сделаете в первые три дня',
    'Как скажете заказчику',
    'Как не допустить повтора',
  ];
  return {
    candidateAnswer: answer,
    grade: grades.every((grade) => grade === 'confirmed') ? 'confirmed' : 'partial',
    criteria: grades.map((grade, index) => ({
      criterionId: `k${index}`,
      grade,
      explanation: names[index] ?? `Пункт ${index + 1}`,
      candidateExcerpt: 'разбор причин с командой',
      sourceRefIds: [],
    })),
  };
}

export type SkillRun = ReturnType<typeof baseRun>;

export function baseRun(status: 'dialogue' | 'cases' = 'cases') {
  const cases = [
    skillCase('c1', 'Go, PostgreSQL', 'Сервис отвечает медленно под нагрузкой. С чего начнёте?'),
    skillCase(
      'c2',
      'Управление сроками',
      'Команда сорвала срок релиза на две недели. Что вы сделаете?',
    ),
    skillCase('c3', 'Kubernetes', 'Под падает после выката. Как будете разбираться?'),
  ];
  if (status === 'cases') {
    cases[0] = {
      ...cases[0]!,
      status: 'answered',
      answer: 'ответ',
      evaluation: evaluation('ответ', ['confirmed', 'confirmed']),
    };
  }
  return {
    id: '11111111-1111-4111-8111-111111111111',
    revision: 4,
    roleTitle: ROLE,
    roleVersion: 1,
    status: status as string,
    startedAt: AT,
    updatedAt: AT,
    completedAt: null as string | null,
    sampleSize: 64,
    evidenceObservedAt: AT,
    dialogueQuestions: ['Какой командой вы руководили?', 'Как планируете сроки?', 'Как нанимали?'],
    dialogueEntries: [],
    currentDialogueIndex: status === 'dialogue' ? 0 : 3,
    suggestions: [] as Array<Record<string, unknown>>,
    cases,
    skills: [
      {
        id: 'skill-c1',
        name: 'Go, PostgreSQL',
        isKeySkill: true,
        grade: status === 'cases' ? 'confirmed' : 'not_confirmed',
        explanation: 'x',
        caseId: 'c1',
        sourceRefs: [],
      },
      {
        id: 'skill-c2',
        name: 'Управление сроками',
        isKeySkill: true,
        grade: 'not_confirmed',
        explanation: 'x',
        caseId: 'c2',
        sourceRefs: [],
      },
      {
        id: 'skill-c3',
        name: 'Kubernetes',
        isKeySkill: false,
        grade: 'not_confirmed',
        explanation: 'x',
        caseId: 'c3',
        sourceRefs: [],
      },
    ],
    currentCaseIndex: status === 'cases' ? 1 : 0,
    readiness: { ready: false, confirmedCount: 1, missingKeySkillIds: [] },
    modelError: null as unknown,
    lastRequest: null,
  };
}

export interface SkillCalls {
  readonly posts: Array<{ readonly path: string; readonly body: Record<string, unknown> }>;
}

export interface SkillOptions {
  /** Состояние до старта; без него открыт прогон `run`. */
  readonly ready?: boolean;
  readonly run?: SkillRun;
  /** Ответ на кейс падает столько раз, потом проходит. */
  readonly failAnswers?: number;
  /** Роли поиска кандидата; по умолчанию одна — `ROLE`. */
  readonly searchRoles?: readonly string[];
  /** Роли, требований которых мало: `insufficient_requirements`, сбор не идёт. */
  readonly insufficient?: readonly string[];
  /** B767: русские названия ролей поиска в ответе кампании. */
  readonly titlesRu?: Readonly<Record<string, string>>;
}

function answered(run: SkillRun, caseId: string, answer: string): SkillRun {
  const cases = run.cases.map((record) =>
    record.assessmentCase.id === caseId
      ? {
          ...record,
          status: 'answered' as const,
          answer,
          evaluation: evaluation(answer, ['confirmed', 'confirmed', 'confirmed']),
          decision: 'pending' as const,
        }
      : record,
  );
  return {
    ...run,
    revision: run.revision + 1,
    cases,
    currentCaseIndex: run.currentCaseIndex + 1,
  };
}

/** B734: навык меняет только «Верно» на итоге. */
function decided(run: SkillRun, caseId: string, accepted: boolean): SkillRun {
  return {
    ...run,
    revision: run.revision + 1,
    cases: run.cases.map((record) =>
      record.assessmentCase.id === caseId
        ? { ...record, decision: accepted ? ('accepted' as const) : ('declined' as const) }
        : record,
    ),
    skills: run.skills.map((skill) =>
      accepted && skill.caseId === caseId ? { ...skill, grade: 'confirmed' } : skill,
    ),
  };
}

function afterDialogue(run: SkillRun): SkillRun {
  const suggestions = ['Руководил командой из 12 человек', 'Планировал релизы по кварталам'].map(
    (statement, index) => ({
      id: `2222222${index}-2222-4222-8222-222222222222`,
      domain: 'responsibility',
      statement,
      sourceExcerpt: statement,
      sourceMessageId: '33333333-3333-4333-8333-333333333333',
      selected: true,
      accepted: false,
    }),
  );
  return {
    ...run,
    revision: run.revision + 1,
    status: 'suggestions',
    currentDialogueIndex: 3,
    suggestions,
  };
}

/** Кабинет под флагом с моками проверки; записи экрана копятся в `calls.posts`. */
export async function openSkillCheck(
  page: Page,
  path: string,
  options: SkillOptions = {},
): Promise<SkillCalls> {
  const calls: SkillCalls = { posts: [] };
  let run = options.run ?? baseRun();
  let fails = options.failAnswers ?? 0;
  await mockSignedInCabinet(page, { cabinetB640: true });
  const ready = {
    state: 'ready',
    roleTitle: ROLE,
    roleVersion: 1,
    sampleSize: 64,
    evidenceObservedAt: AT,
    skills: run.skills.map((skill) => ({
      skillId: skill.id,
      name: skill.name,
      vacancyCount: 40,
      isKeySkill: true,
      sourceRefs: [],
    })),
    cases: [],
  };
  let started = !options.ready;
  const searchRoles = options.searchRoles ?? [ROLE];
  await page.route('**/api/v1/candidate/campaign', (route) =>
    route.fulfill({
      json: {
        data: {
          roles: { value: searchRoles, origin: 'explicit' },
          regions: { value: [], origin: 'default' },
          ...(options.titlesRu ? { titlesRu: options.titlesRu } : {}),
        },
      },
    }),
  );
  await page.route(`${BASE}/current*`, (route) => {
    const role = new URL(route.request().url()).searchParams.get('role') ?? ROLE;
    if (options.insufficient?.includes(role)) {
      const data = {
        state: 'insufficient_requirements',
        roleTitle: role,
        sampleSize: 12,
        requirementCount: 1,
        collecting: false,
      };
      return route.fulfill({ json: { data } });
    }
    return route.fulfill({ json: { data: started ? { state: 'run', run } : ready } });
  });
  await page.route(`${BASE}/start`, (route) => {
    started = true;
    calls.posts.push({ path: 'start', body: route.request().postDataJSON() });
    return route.fulfill({ json: { data: { state: 'run', run } } });
  });
  await page.route(`${BASE}/*/**`, (route: Route) => {
    const path = new URL(route.request().url()).pathname.split('/role-skill-assessments/')[1] ?? '';
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.posts.push({ path, body });
    if (path.endsWith('/answer')) {
      if (fails > 0) {
        fails -= 1;
        return route.fulfill({
          status: 502,
          json: { error: { code: 'model_failed', message: 'x' } },
        });
      }
      run = answered(run, path.split('/')[2] ?? '', String(body.answer));
    } else if (path.endsWith('/decision')) {
      run = decided(run, path.split('/')[2] ?? '', body.accepted === true);
    } else if (path.endsWith('/dialogue')) {
      run = afterDialogue(run);
    } else if (path.endsWith('/suggestions')) {
      run = { ...run, revision: run.revision + 1, status: 'cases' };
    }
    return route.fulfill({ json: { data: { state: 'run', run } } });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return calls;
}
