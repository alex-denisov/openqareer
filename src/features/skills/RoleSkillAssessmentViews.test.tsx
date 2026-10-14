import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RoleSkillAssessmentRun } from '../../../server/domain/roleSkillAssessment';
import {
  InsufficientRequirementsState,
  LoadingState,
  NoRoleState,
  ProgressTrack,
  SourceErrorState,
  StartState,
  TooFewVacanciesState,
} from './RoleSkillAssessmentStartViews';
import { ModelErrorState } from './RoleSkillAssessmentCaseViews';

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
    const sourceErr = renderToStaticMarkup(<SourceErrorState onRetry={() => undefined} />);

    expect(loading).toContain('Загружаем требования');
    expect(noRole).toContain('Сначала выберите роль');
    expect(tooFew).toContain('Пока мало вакансий для проверки');
    expect(insufficient).toContain('Требований пока недостаточно');
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
      <ModelErrorState
        busy={false}
        onRetry={() => undefined}
        run={mockRun}
      />,
    );

    expect(html).toContain('Модель не завершила проверку');
    expect(html).toContain('Ответ не оценён: модель не ответила');
    expect(html).toContain('Повторить');
    expect(html).toContain('evaluation');
  });
});
