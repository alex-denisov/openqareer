import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RoleSkillAssessmentRun } from '../../../server/domain/roleSkillAssessment';
import {
  InsufficientRequirementsState,
  LoadingState,
  NoRoleState,
  ProgressTrack,
  SourceErrorState,
  RunSkillOverview,
  StartState,
  TooFewVacanciesState,
} from './RoleSkillAssessmentStartViews';
import { EvaluationDetails, ModelErrorState } from './RoleSkillAssessmentCaseViews';
import { SuggestionsState } from './RoleSkillAssessmentConversationViews';

function caseFor(skillId: string, status: 'pending' | 'answered' | 'skipped', graded: boolean) {
  return {
    assessmentCase: { id: `case-${skillId}`, skillId },
    status,
    answer: status === 'answered' ? 'Ответ' : null,
    evaluation: graded ? { candidateAnswer: 'Ответ', grade: 'not_confirmed', criteria: [] } : null,
    evaluationHistory: [],
    appealReason: null,
    pendingDiscussionQuestion: null,
    discussion: [],
  } as unknown as RoleSkillAssessmentRun['cases'][number];
}

describe('RoleSkillAssessmentViews (AUD-11 / B462)', () => {
  it('renders start state with intro, steps and criteria note', () => {
    const html = renderToStaticMarkup(
      <StartState
        current={{
          state: 'ready',
          roleTitle: 'CTO в финтехе',
          roleVersion: 1,
          sampleSize: 41,
          evidenceObservedAt: '2026-10-14',
          skills: [],
          cases: [],
        }}
        consent={false}
        busy={false}
        howItWorksOpen={true}
        onToggleHowItWorks={() => undefined}
        onConsent={() => undefined}
        onStart={() => undefined}
        onLater={() => undefined}
      />,
    );

    expect(html).toContain('CTO в финтехе');
    expect(html).toContain('Около 20 минут: короткий диалог и три практических кейса');
    expect(html).toContain('Начать проверку');
  });

  it('renders progress track with 5 stages', () => {
    const html = renderToStaticMarkup(<ProgressTrack step={2} />);
    expect(html).toContain('Шаг 2 из 5');
    expect(html).toContain('Диалог');
    expect(html).toContain('Кейс 1');
    expect(html).toContain('Кейс 2');
    expect(html).toContain('Кейс 3');
    expect(html).toContain('Итог');
  });

  it('renders loading, error and edge states with honest non-invented messaging', () => {
    const loading = renderToStaticMarkup(<LoadingState />);
    const noRole = renderToStaticMarkup(<NoRoleState onOpenOpportunities={() => undefined} />);
    const tooFew = renderToStaticMarkup(
      <TooFewVacanciesState
        current={{
          state: 'too_few_vacancies',
          roleTitle: 'CTO',
          sampleSize: 3,
          threshold: 10,
        }}
        onOpenOpportunities={() => undefined}
      />,
    );
    const insufficient = renderToStaticMarkup(
      <InsufficientRequirementsState
        current={{
          state: 'insufficient_requirements',
          roleTitle: 'CTO',
          sampleSize: 15,
          requirementCount: 3,
        }}
        onOpenOpportunities={() => undefined}
      />,
    );
    const collecting = renderToStaticMarkup(
      <InsufficientRequirementsState
        current={{
          state: 'insufficient_requirements',
          roleTitle: 'CTO',
          sampleSize: 129,
          requirementCount: 0,
          collecting: true,
        }}
        onOpenOpportunities={() => undefined}
      />,
    );
    const sourceErr = renderToStaticMarkup(<SourceErrorState onRetry={() => undefined} />);

    expect(loading).toContain('Загружаем требования');
    expect(noRole).toContain('Сначала выберите роль');
    expect(tooFew).toContain('Пока мало вакансий для проверки');
    expect(insufficient).toContain('Требований пока недостаточно');
    expect(collecting).toContain('Требования собираются');
    expect(collecting).not.toContain('недостаточно');
    expect(sourceErr).toContain('Не удалось сверить вакансии');
  });

  it('renders ModelErrorState with honest retry and explanation', () => {
    const mockRun: RoleSkillAssessmentRun = {
      id: '00000000-0000-4000-8000-000000000001',
      revision: 1,
      roleTitle: 'CTO',
      roleVersion: 1,
      status: 'model_error',
      consentedAt: '2026-10-14T00:00:00.000Z',
      startedAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
      completedAt: null,
      sampleSize: 15,
      evidenceObservedAt: '2026-10-14T00:00:00.000Z',
      dialogueQuestions: ['Вопрос 1', 'Вопрос 2', 'Вопрос 3'],
      dialogueEntries: [],
      currentDialogueIndex: 0,
      suggestions: [],
      cases: [],
      skills: Array.from({ length: 5 }, (_, index) => ({
        id: `skill-${index}`,
        name: `Навык ${index}`,
        isKeySkill: index < 2,
        grade: 'not_confirmed',
        explanation: 'Навык ещё не проверен.',
        caseId: null,
        sourceRefs: [],
      })),
      currentCaseIndex: 0,
      readiness: { ready: false, confirmedCount: 0, missingKeySkillIds: ['skill-0', 'skill-1'] },
      modelError: { action: 'evaluation', code: 'model_timeout', caseId: 'case-1' },
      lastRequest: null,
    };

    const html = renderToStaticMarkup(
      <ModelErrorState busy={false} onRetry={() => undefined} run={mockRun} />,
    );

    expect(html).toContain('Модель не завершила проверку');
    expect(html).toContain('Ответ не оценён: модель не ответила');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('Действие');
    expect(html).not.toContain('evaluation');
    expect(html).not.toContain('Перейти к кейсам');

    const suggestionsHtml = renderToStaticMarkup(
      <ModelErrorState
        busy={false}
        onRetry={() => undefined}
        onSkipSuggestions={() => undefined}
        run={{
          ...mockRun,
          modelError: { action: 'suggestions', code: 'provider_output_invalid', caseId: null },
        }}
      />,
    );
    expect(suggestionsHtml).toContain('Ответы сохранены');
    expect(suggestionsHtml).toContain('Перейти к кейсам без предложений');
    expect(suggestionsHtml).not.toContain('suggestions');
  });

  it('marks a skill «Не проверено» until its case answer is graded (B564)', () => {
    const run = {
      ...BASE_RUN,
      cases: [
        caseFor('skill-0', 'pending', false),
        caseFor('skill-1', 'answered', true),
        caseFor('skill-2', 'skipped', false),
      ],
    } as RoleSkillAssessmentRun;

    const html = renderToStaticMarkup(<RunSkillOverview run={run} />);

    expect(html.match(/Не проверено/gu)).toHaveLength(2);
    expect(html.match(/Не подтверждено/gu)).toHaveLength(1);
  });

  it('opens the cases from an empty suggestion list with an honest note (B564)', () => {
    const html = renderToStaticMarkup(
      <SuggestionsState
        run={{ ...BASE_RUN, status: 'suggestions' } as RoleSkillAssessmentRun}
        drafts={{}}
        busy={false}
        onDrafts={() => undefined}
        onSetAll={() => undefined}
        onAcceptAll={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(html).toContain('Не нашли в ответах фактов');
    expect(html).toContain('Перейти к кейсам');
    expect(html).not.toContain('Выбрать всё');
    expect(html).not.toContain('из 12');
  });

  it('B565: suggestions and grading criteria carry Russian labels, not service codes', () => {
    const suggestion = {
      id: '00000000-0000-4000-8000-000000000010',
      domain: 'skill',
      statement: 'Вёл бюджет направления',
      sourceExcerpt: 'Вёл бюджет',
      sourceMessageId: '00000000-0000-4000-8000-000000000011',
      selected: true,
      accepted: false,
    } as const;
    const suggestionsHtml = renderToStaticMarkup(
      <SuggestionsState
        run={
          {
            ...BASE_RUN,
            status: 'suggestions',
            suggestions: [suggestion],
          } as RoleSkillAssessmentRun
        }
        drafts={{}}
        busy={false}
        onDrafts={() => undefined}
        onSetAll={() => undefined}
        onAcceptAll={() => undefined}
        onSave={() => undefined}
      />,
    );
    expect(suggestionsHtml).toContain('<strong>Навык</strong>');
    expect(suggestionsHtml).not.toContain('<strong>skill</strong>');

    const criteria = ['context', 'actions', 'verification'].map((criterionId) => ({
      criterionId,
      grade: 'confirmed' as const,
      explanation: 'Объяснение',
      candidateExcerpt: 'Цитата',
      sourceRefIds: [],
    }));
    const evaluationHtml = renderToStaticMarkup(
      <EvaluationDetails evaluation={{ candidateAnswer: 'Ответ', grade: 'confirmed', criteria }} />,
    );
    expect(evaluationHtml).toContain('Исходные данные и риск · Подтверждено');
    expect(evaluationHtml).toContain('Порядок действий · Подтверждено');
    expect(evaluationHtml).toContain('Проверка результата · Подтверждено');
    expect(evaluationHtml).not.toMatch(/>(context|actions|verification) ·/u);
  });
});

const BASE_RUN = {
  id: '00000000-0000-4000-8000-000000000002',
  revision: 3,
  roleTitle: 'Операционный директор (COO)',
  roleVersion: 1,
  status: 'cases',
  consentedAt: '2026-10-25T00:00:00.000Z',
  startedAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
  completedAt: null,
  sampleSize: 301,
  evidenceObservedAt: '2026-10-25T00:00:00.000Z',
  dialogueQuestions: ['Вопрос 1', 'Вопрос 2', 'Вопрос 3'],
  dialogueEntries: [],
  currentDialogueIndex: 3,
  suggestions: [],
  cases: [],
  skills: Array.from({ length: 3 }, (_, index) => ({
    id: `skill-${index}`,
    name: `Навык ${index}`,
    isKeySkill: index === 0,
    grade: 'not_confirmed' as const,
    explanation: 'Навык ещё не проверен.',
    caseId: `case-skill-${index}`,
    sourceRefs: [],
  })),
  currentCaseIndex: 0,
  readiness: { ready: false, confirmedCount: 0, missingKeySkillIds: ['skill-0'] },
  modelError: null,
  lastRequest: null,
} satisfies Partial<RoleSkillAssessmentRun>;
