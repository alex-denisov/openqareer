import type {
  RoleSkillAssessmentRun,
  RoleSkillEvaluation,
} from '../../server/domain/roleSkillAssessment';

const assessmentRole = 'CTO в финтехе';
const assessmentSkills = [
  'Платёжные системы',
  'Kafka и Kubernetes',
  'Регуляторика (ЦБ, PCI DSS)',
  'Управление бюджетом разработки',
  'Опыт совета директоров',
];
const assessmentQuestions = [
  'Какую часть работы в этой роли вы брали на себя?',
  'Какой результат вашей работы можно подтвердить наблюдаемым фактом или показателем?',
  'Какие ограничения, команда или решение повлияли на этот результат?',
];

function createAssessmentReadyState() {
  const skills = assessmentSkills.map((name, index) => ({
    skillId: `skill-${index + 1}`,
    name,
    vacancyCount: 10 - index,
    isKeySkill: index < 2,
    sourceRefs: [assessmentSource(index)],
  }));
  return {
    state: 'ready' as const,
    roleTitle: assessmentRole,
    roleVersion: 1,
    sampleSize: 12,
    evidenceObservedAt: '2026-10-09T12:00:00.000Z',
    skills,
    cases: skills.slice(0, 3).map((skill, index) => ({
      id: `assessment-case-${index + 1}`,
      roleId: 'cto-fintech',
      requirementId: `requirement-${index + 1}`,
      skillId: skill.skillId,
      skillName: skill.name,
      prompt: `Расскажите о ситуации, где вы применили навык «${skill.name}». Какое решение приняли и что изменилось?`,
      requirementsCount: skill.vacancyCount,
      sourceRefs: skill.sourceRefs,
    })),
  };
}

function assessmentSource(index: number) {
  return {
    id: `source-reference-${index + 1}`,
    vacancyId: `vacancy-${index + 1}`,
    observedAt: '2026-10-09T12:00:00.000Z',
    sourceName: 'Вакансия из тестовой выборки',
  };
}

function createAssessmentRun(): RoleSkillAssessmentRun {
  const ready = createAssessmentReadyState();
  const now = new Date().toISOString();
  const cases = ready.cases.map((assessmentCase, index) => ({
    assessmentCase,
    status: 'pending' as const,
    answer: null,
    evaluation: null,
    evaluationHistory: [],
    appealReason: null,
    pendingDiscussionQuestion: null,
    discussion: [],
    index,
  }));
  return {
    id: 'dfd65550-badd-43b0-955f-63c1b2b67d54',
    revision: 1,
    roleTitle: assessmentRole,
    roleVersion: 1,
    status: 'dialogue',
    consentedAt: now,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sampleSize: 12,
    evidenceObservedAt: '2026-10-09T12:00:00.000Z',
    dialogueQuestions: [...assessmentQuestions],
    dialogueEntries: [],
    currentDialogueIndex: 0,
    suggestions: [],
    cases: cases.map(({ index: _index, ...record }) => record),
    skills: ready.skills.map((skill, index) => ({
      id: skill.skillId,
      name: skill.name,
      isKeySkill: skill.isKeySkill,
      grade: 'not_confirmed',
      explanation: 'Навык ещё не проверен.',
      caseId: index < 3 ? `assessment-case-${index + 1}` : null,
      sourceRefs: skill.sourceRefs,
    })),
    currentCaseIndex: 0,
    readiness: { ready: false, confirmedCount: 0, missingKeySkillIds: ['skill-1', 'skill-2'] },
    modelError: null,
    lastRequest: null,
  };
}

function readFocus(value: unknown): { vacancyId: string; skills: string[] } | null {
  if (!value || typeof value !== 'object') return null;
  const { vacancyId, skills } = value as { vacancyId?: unknown; skills?: unknown };
  if (typeof vacancyId !== 'string' || !Array.isArray(skills) || skills.length === 0) return null;
  return { vacancyId, skills: skills.map(String) };
}

/** B552: the first focus skill gets a case; the rest have too little data in the role sample. */
function createFocusedRun(focus: { vacancyId: string; skills: string[] }): RoleSkillAssessmentRun {
  const base = createAssessmentRun();
  const [covered, ...lacking] = focus.skills;
  const first = base.cases[0]!;
  const focusCase = {
    ...first,
    assessmentCase: {
      ...first.assessmentCase,
      id: 'focus-case-1',
      skillId: 'focus-skill-1',
      skillName: covered!,
      prompt: `Расскажите о практической ситуации, в которой вы применяли «${covered}». Как вы выбрали действия, учли риски и проверили результат?`,
    },
  };
  return {
    ...base,
    cases: [focusCase],
    skills: [
      { ...base.skills[0]!, id: 'focus-skill-1', name: covered!, caseId: 'focus-case-1' },
      ...base.skills.slice(1).map((skill) => ({ ...skill, isKeySkill: false, caseId: null })),
    ],
    readiness: { ready: false, confirmedCount: 0, missingKeySkillIds: ['focus-skill-1'] },
    focus: {
      vacancyId: focus.vacancyId,
      vacancyTitle: 'Head of Product, Payments',
      skills: focus.skills,
      sampleRoleTitle: assessmentRole,
      roleNote: null,
      lackingNotes: lacking.map(
        (skill) => `Мало данных по ${skill}: навык есть в 1 из нужных 3 вакансий роли.`,
      ),
    },
  };
}

interface AssessmentStubResponse {
  data?: unknown;
  error?: { code: string; message: string };
  status?: number;
  nextRun?: RoleSkillAssessmentRun;
  nextFailFirstEvaluation?: boolean;
}

export interface MockSignedInCabinetOptions {
  assessmentDelayMs?: number;
  assessmentInitialState?:
    | 'ready'
    | 'role_not_selected'
    | 'source_unavailable'
    | 'too_few_vacancies'
    | 'insufficient_requirements'
    | 'suggestions'
    | 'partial_result'
    | 'open_result';
}

function responseForRun(run: RoleSkillAssessmentRun, stale = false): AssessmentStubResponse {
  const state = run.status === 'complete' ? 'result' : 'run';
  return { data: state === 'result' ? { state, run, stale } : { state, run }, nextRun: run };
}

function createAssessmentSuggestionsRun(): RoleSkillAssessmentRun {
  const run = createAssessmentRun();
  const now = new Date().toISOString();
  const dialogueEntries = run.dialogueQuestions.map((question, index) => ({
    id: crypto.randomUUID(),
    question,
    answer: `Опыт кандидата с проверяемым фактом ${index + 1}.`,
    answeredAt: now,
  }));
  return {
    ...run,
    status: 'suggestions',
    dialogueEntries,
    currentDialogueIndex: 3,
    suggestions: createAssessmentSuggestions(dialogueEntries[0]!.id),
  };
}

function createPartialAssessmentResult(): RoleSkillAssessmentRun {
  const run = createAssessmentRun();
  const cases = run.cases.map((record, index) => {
    const grade = index === 1 ? 'partial' : 'confirmed';
    const answer = `Пример решения для навыка ${index + 1} с измеримым итогом.`;
    const evaluation = mutableAssessmentEvaluation(
      createAssessmentEvaluation(answer, record.assessmentCase.sourceRefs[0]!.id, grade),
    );
    return { ...record, status: 'answered' as const, answer, evaluation };
  });
  const skills = run.skills.map((skill, index) => ({
    ...skill,
    grade:
      index < 3
        ? index === 1
          ? ('partial' as const)
          : ('confirmed' as const)
        : ('not_confirmed' as const),
    explanation:
      index < 3 ? 'Ответ содержит критерии, подтверждённые примером.' : 'Навык ещё не проверен.',
  }));
  return {
    ...run,
    status: 'complete',
    completedAt: '2026-10-10T10:00:00.000Z',
    currentCaseIndex: 3,
    cases,
    skills,
    readiness: { ready: false, confirmedCount: 2, missingKeySkillIds: ['skill-2'] },
  };
}

function createOpenAssessmentResult(): RoleSkillAssessmentRun {
  const run = createPartialAssessmentResult();
  const skills = run.skills.map((skill, index) =>
    index === 1 || index === 3 ? { ...skill, grade: 'confirmed' as const } : skill,
  );
  return {
    ...run,
    skills,
    readiness: { ready: true, confirmedCount: 4, missingKeySkillIds: [] },
  };
}

function initialAssessmentResponse(
  state: MockSignedInCabinetOptions['assessmentInitialState'],
): AssessmentStubResponse {
  if (state === 'role_not_selected' || state === 'source_unavailable') return { data: { state } };
  if (state === 'too_few_vacancies')
    return { data: { state, roleTitle: assessmentRole, sampleSize: 4, threshold: 8 } };
  if (state === 'insufficient_requirements')
    return { data: { state, roleTitle: assessmentRole, sampleSize: 12, requirementCount: 3 } };
  if (state === 'suggestions') return responseForRun(createAssessmentSuggestionsRun());
  if (state === 'partial_result') return responseForRun(createPartialAssessmentResult());
  if (state === 'open_result') return responseForRun(createOpenAssessmentResult());
  return { data: createAssessmentReadyState() };
}

function handleAssessmentRoute(
  path: string,
  method: string,
  body: Record<string, unknown>,
  currentRun: RoleSkillAssessmentRun | undefined,
  failFirstEvaluation: boolean,
  initialState: MockSignedInCabinetOptions['assessmentInitialState'],
): AssessmentStubResponse | null {
  // The role pressed on «Карьера» arrives as `?role=` / `role` (B445).
  const requestedRole = typeof body.role === 'string' ? body.role : undefined;
  if (path.endsWith('/candidate/role-skill-assessments/checked-roles') && method === 'GET') {
    const done = currentRun?.status === 'complete' && currentRun.completedAt;
    return {
      data: done
        ? [
            {
              roleTitle: currentRun.roleTitle,
              completedAt: currentRun.completedAt,
              confirmedSkills: currentRun.skills
                .filter((skill) => skill.grade === 'confirmed')
                .map((skill) => skill.name),
            },
          ]
        : [],
    };
  }
  if (path.endsWith('/candidate/role-skill-assessments/current') && method === 'GET') {
    if (currentRun && (!requestedRole || currentRun.roleTitle === requestedRole)) {
      return responseForRun(currentRun, currentRun.status === 'complete');
    }
    const initial = initialAssessmentResponse(initialState);
    return requestedRole && initialState === 'ready'
      ? { data: { ...(initial.data as object), roleTitle: requestedRole } }
      : initial;
  }
  if (path.endsWith('/candidate/role-skill-assessments/start') && method === 'POST') {
    const focus = readFocus(body.focus);
    const run = focus ? createFocusedRun(focus) : createAssessmentRun();
    return responseForRun(requestedRole ? { ...run, roleTitle: requestedRole } : run);
  }
  const match = path.match(/\/role-skill-assessments\/([^/]+)(\/.*)$/u);
  if (!match) return null;
  if (!currentRun || currentRun.id !== match[1]) {
    return {
      status: 404,
      error: { code: 'assessment_not_found', message: 'Проверка не найдена.' },
    };
  }
  return processAssessmentAction(currentRun, match[2]!, body, failFirstEvaluation);
}

function processAssessmentAction(
  run: RoleSkillAssessmentRun,
  actionPath: string,
  body: Record<string, unknown>,
  failFirstEvaluation: boolean,
): AssessmentStubResponse {
  if (actionPath === '/dialogue') return recordAssessmentDialogue(run, body);
  if (actionPath === '/suggestions') return acceptAssessmentSuggestions(run, body);
  if (actionPath === '/suggestions/rollback') return rollbackAssessmentSuggestions(run);
  if (actionPath === '/retry') {
    return responseForRun({
      ...run,
      revision: run.revision + 1,
      status: 'cases',
      modelError: null,
    });
  }
  const match = actionPath.match(/^\/cases\/([^/]+)\/(draft|answer|skip|discuss|appeal)$/u);
  if (!match)
    return { status: 404, error: { code: 'not_found', message: 'Неизвестное действие.' } };
  const response = updateAssessmentCase(
    run,
    decodeURIComponent(match[1]!),
    match[2]!,
    body,
    failFirstEvaluation,
  );
  return response;
}

function recordAssessmentDialogue(
  run: RoleSkillAssessmentRun,
  body: Record<string, unknown>,
): AssessmentStubResponse {
  const index = run.currentDialogueIndex;
  const entry = {
    id: crypto.randomUUID(),
    question: run.dialogueQuestions[index]!,
    answer: String(body.answer ?? ''),
    answeredAt: new Date().toISOString(),
  };
  const dialogueEntries = [...run.dialogueEntries, entry];
  const nextRun: RoleSkillAssessmentRun = {
    ...run,
    revision: run.revision + 1,
    updatedAt: entry.answeredAt,
    dialogueEntries,
    currentDialogueIndex: index + 1,
    status: dialogueEntries.length === 3 ? 'suggestions' : 'dialogue',
    suggestions:
      dialogueEntries.length === 3 ? createAssessmentSuggestions(entry.id) : run.suggestions,
  };
  return responseForRun(nextRun);
}

function createAssessmentSuggestions(sourceMessageId: string) {
  return Array.from({ length: 12 }, (_, index) => ({
    id: crypto.randomUUID(),
    domain: 'responsibility' as const,
    statement: `Ответ кандидата подтверждает факт ${index + 1}.`,
    sourceExcerpt: 'Ответ кандидата',
    sourceMessageId,
    selected: false,
    accepted: false,
  }));
}

function acceptAssessmentSuggestions(
  run: RoleSkillAssessmentRun,
  body: Record<string, unknown>,
): AssessmentStubResponse {
  const choices = Array.isArray(body.suggestions)
    ? (body.suggestions as Array<Record<string, unknown>>)
    : [];
  const byId = new Map(choices.map((choice) => [String(choice.id), choice]));
  const suggestions = run.suggestions.map((suggestion) => ({
    ...suggestion,
    accepted: Boolean(byId.get(suggestion.id)?.accepted),
    selected: Boolean(byId.get(suggestion.id)?.accepted),
    statement: String(byId.get(suggestion.id)?.statement ?? suggestion.statement),
  }));
  const memoryIds = suggestions
    .filter((suggestion) => suggestion.accepted)
    .map(() => crypto.randomUUID());
  return responseForRun({
    ...run,
    revision: run.revision + 1,
    status: 'cases',
    suggestions,
    profileChange:
      memoryIds.length > 0
        ? { memoryIds, acceptedAt: new Date().toISOString(), revertedAt: null }
        : { memoryIds: [], acceptedAt: null, revertedAt: null },
  });
}

function rollbackAssessmentSuggestions(run: RoleSkillAssessmentRun): AssessmentStubResponse {
  if (!run.profileChange?.memoryIds.length) {
    return {
      status: 409,
      error: {
        code: 'profile_suggestions_not_active',
        message: 'Нет активных принятых предложений.',
      },
    };
  }
  return responseForRun({
    ...run,
    revision: run.revision + 1,
    profileChange: { ...run.profileChange, memoryIds: [], revertedAt: new Date().toISOString() },
  });
}

function updateAssessmentCase(
  run: RoleSkillAssessmentRun,
  caseId: string,
  action: string,
  body: Record<string, unknown>,
  failFirstEvaluation: boolean,
): AssessmentStubResponse {
  const index = run.cases.findIndex((record) => record.assessmentCase.id === caseId);
  if (index < 0)
    return {
      status: 404,
      error: { code: 'assessment_case_not_found', message: 'Кейс не найден.' },
    };
  if (action === 'draft') return saveAssessmentDraft(run, index, body);
  if (action === 'discuss') return discussAssessmentCase(run, index, body);
  if (action === 'appeal') return appealAssessmentCase(run, index, body);
  if (action === 'skip') return skipAssessmentCase(run, index);
  if (action === 'answer' && failFirstEvaluation) {
    const failedRun = createFailedEvaluationRun(run, index, String(body.answer ?? ''));
    return { ...responseForRun(failedRun), nextFailFirstEvaluation: false };
  }
  return evaluateAssessmentCase(run, index, body);
}

function createFailedEvaluationRun(
  run: RoleSkillAssessmentRun,
  index: number,
  answer: string,
): RoleSkillAssessmentRun {
  return {
    ...run,
    revision: run.revision + 1,
    status: 'model_error',
    modelError: {
      action: 'evaluation',
      code: 'provider_unavailable',
      caseId: run.cases[index]!.assessmentCase.id,
    },
    cases: run.cases.map((record, caseIndex) =>
      caseIndex === index ? { ...record, answer } : record,
    ),
  };
}

function saveAssessmentDraft(
  run: RoleSkillAssessmentRun,
  index: number,
  body: Record<string, unknown>,
): AssessmentStubResponse {
  const cases = run.cases.map((record, itemIndex) =>
    itemIndex === index ? { ...record, answer: String(body.draft ?? '') || null } : record,
  );
  return responseForRun({ ...run, revision: run.revision + 1, cases });
}

function discussAssessmentCase(
  run: RoleSkillAssessmentRun,
  index: number,
  body: Record<string, unknown>,
): AssessmentStubResponse {
  const cases = run.cases.map((record, itemIndex) =>
    itemIndex === index
      ? {
          ...record,
          discussion: [
            ...record.discussion,
            {
              question: String(body.question ?? ''),
              answer: 'Рассмотрите масштаб решения и результат для команды.',
              createdAt: new Date().toISOString(),
            },
          ],
        }
      : record,
  );
  return responseForRun({ ...run, revision: run.revision + 1, cases });
}

function appealAssessmentCase(
  run: RoleSkillAssessmentRun,
  index: number,
  body: Record<string, unknown>,
): AssessmentStubResponse {
  const current = run.cases[index]!;
  if (!current.evaluation)
    return {
      status: 409,
      error: { code: 'assessment_case_not_evaluated', message: 'Сначала завершите оценку кейса.' },
    };
  const cases = run.cases.map((record, itemIndex) =>
    itemIndex === index
      ? {
          ...record,
          evaluationHistory: [...record.evaluationHistory, current.evaluation!].slice(-5),
          appealReason: String(body.reason ?? ''),
        }
      : record,
  );
  return responseForRun({ ...run, revision: run.revision + 1, cases });
}

function skipAssessmentCase(run: RoleSkillAssessmentRun, index: number): AssessmentStubResponse {
  const cases = run.cases.map((record, itemIndex) =>
    itemIndex === index ? { ...record, status: 'skipped' as const } : record,
  );
  const currentCaseIndex = index + 1;
  const complete = currentCaseIndex >= cases.length;
  const skills = run.skills.map((skill) =>
    skill.id === run.cases[index]?.assessmentCase.skillId
      ? {
          ...skill,
          grade: 'not_confirmed' as const,
          explanation: 'Кейс пропущен; навык остался непроверенным.',
        }
      : skill,
  );
  return responseForRun({
    ...run,
    revision: run.revision + 1,
    cases,
    skills,
    currentCaseIndex,
    status: complete ? 'complete' : 'cases',
    completedAt: complete ? new Date().toISOString() : null,
  });
}

function evaluateAssessmentCase(
  run: RoleSkillAssessmentRun,
  index: number,
  body: Record<string, unknown>,
): AssessmentStubResponse {
  const answer = String(body.answer ?? '');
  const record = run.cases[index]!;
  const grade = index === 2 ? ('partial' as const) : ('confirmed' as const);
  const evaluation = mutableAssessmentEvaluation(
    createAssessmentEvaluation(answer, record.assessmentCase.sourceRefs[0]!.id, grade),
  );
  const cases = run.cases.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          status: 'answered' as const,
          answer,
          evaluation,
          evaluationHistory: item.evaluation
            ? [...item.evaluationHistory, item.evaluation].slice(-5)
            : item.evaluationHistory,
          appealReason: null,
        }
      : item,
  );
  const skills = run.skills.map((skill) =>
    skill.id === record.assessmentCase.skillId
      ? {
          ...skill,
          grade,
          explanation: 'Ответ приводит пример, действие и результат.',
        }
      : skill,
  );
  const currentCaseIndex = Math.max(run.currentCaseIndex, index + 1);
  const complete =
    currentCaseIndex >= cases.length &&
    cases.every((item) => item.status === 'answered' || item.status === 'skipped');
  const confirmedCount = skills.filter((skill) => skill.grade === 'confirmed').length;
  const missingKeySkillIds = skills
    .filter((skill) => skill.isKeySkill && skill.grade !== 'confirmed')
    .map((skill) => skill.id);
  return responseForRun({
    ...run,
    revision: run.revision + 1,
    cases,
    skills,
    currentCaseIndex,
    status: complete ? 'complete' : 'cases',
    completedAt: complete ? new Date().toISOString() : run.completedAt,
    readiness: {
      ready: confirmedCount >= 3 && missingKeySkillIds.length === 0,
      confirmedCount,
      missingKeySkillIds,
    },
  });
}

function createAssessmentEvaluation(
  answer: string,
  sourceRefId: string,
  grade: 'confirmed' | 'partial' = 'confirmed',
): RoleSkillEvaluation {
  const excerpt = answer.slice(0, 80);
  return {
    candidateAnswer: answer,
    grade,
    criteria: ['context', 'actions', 'verification'].map((criterionId) => ({
      criterionId,
      grade,
      explanation: 'Ответ содержит конкретный пример, действие и наблюдаемый результат.',
      candidateExcerpt: excerpt,
      sourceRefIds: [sourceRefId],
    })),
  };
}

function mutableAssessmentEvaluation(evaluation: RoleSkillEvaluation) {
  return {
    candidateAnswer: evaluation.candidateAnswer,
    grade: evaluation.grade,
    criteria: evaluation.criteria.map((criterion) => ({
      ...criterion,
      sourceRefIds: [...criterion.sourceRefIds],
    })),
  };
}

export function createRoleSkillAssessmentFixture(options: MockSignedInCabinetOptions = {}) {
  let assessmentRun: RoleSkillAssessmentRun | undefined;
  let failFirstEvaluation = true;
  return {
    handle(path: string, method: string, body: Record<string, unknown>) {
      const response = handleAssessmentRoute(
        path,
        method,
        body,
        assessmentRun,
        failFirstEvaluation,
        options.assessmentInitialState ?? 'ready',
      );
      if (response?.nextRun) assessmentRun = response.nextRun;
      if (response?.nextFailFirstEvaluation !== undefined) {
        failFirstEvaluation = response.nextFailFirstEvaluation;
      }
      return response;
    },
  };
}
