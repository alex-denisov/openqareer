import type { Page } from '@playwright/test';
import type {
  RoleSkillAssessmentRun,
  RoleSkillEvaluation,
} from '../../server/domain/roleSkillAssessment';
import { mockCandidateCompanies } from './mockCandidateCompanies';
import {
  account,
  candidate,
  candidateSnapshot,
  matchedVacancyPage,
  roleHypotheses,
  todaySnapshot,
  workspace,
} from './readabilityWorkspace';

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

interface AssessmentStubResponse {
  data?: unknown;
  error?: { code: string; message: string };
  status?: number;
  nextRun?: RoleSkillAssessmentRun;
  nextFailFirstEvaluation?: boolean;
}

function responseForRun(run: RoleSkillAssessmentRun, stale = false): AssessmentStubResponse {
  const state = run.status === 'complete' ? 'result' : 'run';
  return { data: state === 'result' ? { state, run, stale } : { state, run }, nextRun: run };
}

function handleAssessmentRoute(
  path: string,
  method: string,
  body: Record<string, unknown>,
  currentRun: RoleSkillAssessmentRun | undefined,
  failFirstEvaluation: boolean,
): AssessmentStubResponse | null {
  if (path.endsWith('/candidate/role-skill-assessments/current') && method === 'GET') {
    return currentRun
      ? responseForRun(currentRun, currentRun.status === 'complete')
      : { data: createAssessmentReadyState() };
  }
  if (path.endsWith('/candidate/role-skill-assessments/start') && method === 'POST') {
    return responseForRun(createAssessmentRun());
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
  const evaluation = createAssessmentEvaluation(answer, record.assessmentCase.sourceRefs[0]!.id);
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
          grade: 'confirmed' as const,
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

function createAssessmentEvaluation(answer: string, sourceRefId: string): RoleSkillEvaluation {
  const excerpt = answer.slice(0, 80);
  return {
    candidateAnswer: answer,
    grade: 'confirmed',
    criteria: ['context', 'actions', 'verification'].map((criterionId) => ({
      criterionId,
      grade: 'confirmed',
      explanation: 'Ответ содержит конкретный пример, действие и наблюдаемый результат.',
      candidateExcerpt: excerpt,
      sourceRefIds: [sourceRefId],
    })),
  };
}

export async function mockSignedInCabinet(page: Page): Promise<string[]> {
  const unmatched: string[] = [];
  let decisionProfile: Record<string, unknown> | null = null;
  let skillQuizCommandId: string | null = null;
  let skillQuizReverted = false;
  let assessmentRun: RoleSkillAssessmentRun | undefined;
  let failFirstEvaluation = true;
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const requestBody = method === 'POST' ? route.request().postDataJSON() : {};
    const assessmentResponse = handleAssessmentRoute(
      path,
      method,
      (requestBody as Record<string, unknown> | undefined) ?? {},
      assessmentRun,
      failFirstEvaluation,
    );
    if (assessmentResponse) {
      if (assessmentResponse.nextRun) assessmentRun = assessmentResponse.nextRun;
      if (assessmentResponse.nextFailFirstEvaluation !== undefined) {
        failFirstEvaluation = assessmentResponse.nextFailFirstEvaluation;
      }
      if (assessmentResponse.error) {
        return route.fulfill({
          status: assessmentResponse.status ?? 400,
          json: { error: assessmentResponse.error },
        });
      }
      return route.fulfill({
        status: assessmentResponse.status ?? 200,
        json: { data: assessmentResponse.data },
      });
    }
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ json: { data: { ...candidate, emailVerified: true } } });
    }
    if (path.endsWith('/candidate/workspace')) {
      return route.fulfill({ json: { data: workspace } });
    }
    if (path.endsWith('/candidate/today')) {
      const existingMomentum =
        'momentum' in todaySnapshot
          ? (todaySnapshot as { momentum?: unknown }).momentum
          : undefined;
      const snapshotWithMomentum = {
        ...todaySnapshot,
        momentum: existingMomentum ?? {
          calculatedAt: '2026-10-09T12:00:00.000Z',
          windows: {
            '7d': { applied: 4, views: 'unknown', screenings: 'unknown', interviews: 1 },
            '30d': { applied: 14, views: 'unknown', screenings: 'unknown', interviews: 2 },
          },
          burnoutNotice: false,
        },
      };
      return route.fulfill({ json: { data: snapshotWithMomentum } });
    }
    // The readability fixture has no tracked applications yet; an empty
    // list is the honest state, not an unknown route.
    if (path.endsWith('/candidate/applications') || path.endsWith('/candidate/drafts')) {
      return route.fulfill({ json: { data: [] } });
    }
    // B370: панель отправки откликов читает лимиты и квитанции; в фикстуре действий нет.
    if (path.endsWith('/candidate/actions/usage')) {
      return route.fulfill({
        json: {
          data: {
            usage: {
              localDate: '2026-10-01',
              hhAppliesCount: 0,
              linkedinEasyAppliesCount: 0,
              hhBoostsCount: 0,
              lastHhBoostAt: null,
            },
            timezone: 'Europe/Moscow',
            resetAt: '2026-10-01T21:00:00.000Z',
            killSwitchActive: false,
            limits: {
              maxHhAppliesPerDay: 15,
              maxLinkedinEasyAppliesPerDay: 10,
              maxHhBoostsPerDay: 3,
              minHhBoostIntervalMinutes: 240,
            },
          },
        },
      });
    }
    if (path.endsWith('/me/consents/actions_on_behalf')) {
      return route.fulfill({
        json: { data: { capability: 'actions_on_behalf', granted: false, consent: null } },
      });
    }
    if (path.endsWith('/candidate/actions/receipts')) {
      return route.fulfill({ json: { data: { receipts: [] } } });
    }
    // C64: шапка Профиля читает согласие «Вы в поиске»; в фикстуре оно не дано.
    if (path.endsWith('/candidate/search-consent')) {
      return route.fulfill({
        json: { data: { consent: { granted: false, policyVersion: '', updatedAt: '' } } },
      });
    }
    if (path.endsWith('/candidate/decision-profile')) {
      if (route.request().method() === 'PUT') {
        decisionProfile = {
          ...route.request().postDataJSON(),
          updatedAt: '2026-10-06T12:00:00.000Z',
        };
      }
      return route.fulfill({ json: { data: decisionProfile } });
    }
    if (path.endsWith('/candidate/skill-quiz/apply') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      skillQuizCommandId = route.request().headers()['idempotency-key'] ?? 'skill-quiz-command';
      skillQuizReverted = false;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const skillName = String(body.skillName ?? 'TypeScript');
      return route.fulfill({
        status: 201,
        json: {
          data: {
            commandId: skillQuizCommandId,
            command: { commandId: skillQuizCommandId },
            result: { quizId: body.quizId, statusLabel: 'подтверждён' },
            fact: {
              skillName,
              status: 'подтверждён',
              source: 'hh.ru',
              date: '2026-10-06',
              scorePercent: 100,
              statement: `${skillName}: подтверждён (hh.ru, 2026-10-06, 100%)`,
            },
          },
        },
      });
    }
    const skillQuizRevert = path.match(/\/candidate\/career-commands\/([^/]+)\/revert$/u);
    if (skillQuizRevert && route.request().method() === 'POST') {
      const commandId = decodeURIComponent(skillQuizRevert[1]!);
      if (commandId !== skillQuizCommandId) {
        return route.fulfill({
          status: 404,
          json: { error: { code: 'career_command_not_found', message: 'Команда не найдена.' } },
        });
      }
      if (skillQuizReverted) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'profile_revision_already_reverted',
              message: 'Это изменение уже отменено',
            },
          },
        });
      }
      skillQuizReverted = true;
      return route.fulfill({ json: { data: { commandId, profileRevisionReverted: true } } });
    }
    if (path.endsWith('/candidate/footprint/plan')) {
      return route.fulfill({
        json: {
          data: {
            plan: [],
            sourceAvailability: {
              sherlock: true,
              maigret: true,
              hibp: false,
              wayback: true,
              exa: false,
            },
            consent: {
              approved: false,
              granted: false,
              versionId: 'digital_footprint-v1.1',
            },
            audit: null,
          },
        },
      });
    }
    if (path.endsWith('/candidate/footprint')) {
      return route.fulfill({ json: { data: { audit: null } } });
    }
    if (path.endsWith('/candidate/visits') && route.request().method() === 'POST') {
      return route.fulfill({ json: { data: { since: null } } });
    }
    if (path.endsWith('/candidate/me')) {
      return route.fulfill({
        json: {
          data: candidateSnapshot,
          meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
        },
      });
    }
    if (path.endsWith('/account/sessions') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { data: { revoked: 2 } } });
    }
    if (path.endsWith('/candidate/export')) {
      return route.fulfill({ json: { data: { profile: account.profile } } });
    }
    if (path.endsWith('/candidate/me') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { data: { deleted: true } } });
    }
    if (path.endsWith('/candidate/consultant-history')) {
      return route.fulfill({ json: { data: [], meta: { nextCursor: null } } });
    }
    const historyConversation = path.match(
      /\/candidate\/consultant-history\/([^/]+)(?:\/messages)?$/u,
    );
    if (historyConversation) {
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'conversation_read_only',
              message: 'Продолжить беседу из истории нельзя.',
            },
          },
        });
      }
      return route.fulfill({
        json: {
          data: {
            id: decodeURIComponent(historyConversation[1]!),
            stage: 'profile',
            openedAt: '2026-10-01T10:00:00.000Z',
            lastMessageAt: '2026-10-01T10:05:00.000Z',
            closedAt: '2026-10-01T10:06:00.000Z',
            messageCount: 2,
            firstPhrase: 'Расскажите о вашем опыте.',
            summary: null,
            messages: [],
          },
        },
      });
    }
    if (path.endsWith('/account')) {
      return route.fulfill({ json: { data: account } });
    }
    if (
      path.endsWith('/candidate/me/memory') ||
      path.endsWith('/candidate/me/turns') ||
      path.endsWith('/candidate/me/messages')
    ) {
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    }
    if (path.endsWith('/candidate/role-hypotheses')) {
      return route.fulfill({ json: { data: roleHypotheses } });
    }
    if (path.endsWith('/candidate/resume')) {
      // B248, owner review 2026-09-23 — this shape used to disagree with
      // `ResumeStudioProjection`/`ResumeEvidenceFreshness`
      // (`server/domain/resumeStudioTypes.ts`): `evidenceFreshness.stale`
      // is an array the surface calls `.length` on, not a boolean, and it
      // crashed into the error boundary the moment «Профиль» started
      // opening this screen instead of a copy of «Сегодня». The client
      // rebuilds its own projection from the draft and never reads this
      // one, but the shape still has to be honest.
      const emptyDocument = {
        kind: 'master',
        targetRole: null,
        contact: { fullName: null, email: null, phone: null, location: null, links: [] },
        experience: [],
        education: [],
        languages: [],
        unknowns: [],
        conventions: {
          country: null,
          packVersion: null,
          reverseChronological: true,
          maxPages: null,
          recommendedBulletsPerRole: null,
          photo: 'omitted',
          discriminatoryPii: 'omitted',
        },
        length: { lines: 0, pages: 1, linesPerPage: 45 },
      };
      return route.fulfill({
        json: {
          data: {
            draft: candidateSnapshot.resume.draft,
            savedAt: {
              createdAt: candidateSnapshot.resume.createdAt,
              updatedAt: candidateSnapshot.resume.updatedAt,
            },
            projection: {
              master: emptyDocument,
              germanyVariant: { ...emptyDocument, kind: 'country-role' },
              evidenceSnapshot: [],
              excludedEvidenceIds: [],
            },
            evidenceFreshness: { valid: true, stale: [] },
          },
        },
      });
    }
    if (path.endsWith('/candidate/matched-vacancies')) {
      return route.fulfill({
        json: matchedVacancyPage(Number(url.searchParams.get('offset') ?? 0)),
      });
    }
    if (
      path.endsWith('/candidate/vacancy-subscriptions') ||
      path.endsWith('/candidate/vacancy-sources') ||
      path.endsWith('/candidate/vacancy-applications') ||
      path.endsWith('/candidate/connections') ||
      path.endsWith('/candidate/career-commands')
    ) {
      return route.fulfill({ json: { data: [] } });
    }
    if (
      path.endsWith('/candidate/strategy') ||
      path.endsWith('/candidate/work-preferences') ||
      path.endsWith('/candidate/reputation-audit') ||
      path.endsWith('/candidate/desktop-tunnel')
    ) {
      return route.fulfill({ json: { data: null } });
    }
    unmatched.push(path);
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await mockCandidateCompanies(page);
  return unmatched;
}
