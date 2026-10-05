import { describe, it, expect } from 'vitest';
import {
  createDefaultExecutiveOnboarding,
  calculateOnboardingProgress,
  toggleTask,
  addGoal,
  addQuantum,
  generateStageAdvice,
  sanitizeWorkplaceInput,
} from './executiveOnboarding';

describe('executiveOnboarding domain model (B357)', () => {
  it('создаёт структуру по умолчанию с этапами prep, days-30, days-60 и days-90', () => {
    const state = createDefaultExecutiveOnboarding('Acme Corp', 'CTO');
    expect(state.companyName).toBe('Acme Corp');
    expect(state.roleTitle).toBe('CTO');
    expect(state.activeStage).toBe('days-30');
    expect(state.tasks.length).toBeGreaterThanOrEqual(12);

    const stages = new Set(state.tasks.map((t) => t.stage));
    expect(stages.has('prep')).toBe(true);
    expect(stages.has('days-30')).toBe(true);
    expect(stages.has('days-60')).toBe(true);
    expect(stages.has('days-90')).toBe(true);
  });

  it('считает прогресс выполнения задач в процентах', () => {
    const state = createDefaultExecutiveOnboarding('Acme Corp', 'CTO');
    const initialProgress = calculateOnboardingProgress(state);
    expect(initialProgress.overallPercent).toBe(0);
    expect(initialProgress.completedCount).toBe(0);

    const firstTaskId = state.tasks[0].id;
    const updatedState = toggleTask(state, firstTaskId);
    const updatedProgress = calculateOnboardingProgress(updatedState);

    expect(updatedProgress.completedCount).toBe(1);
    expect(updatedProgress.overallPercent).toBeGreaterThan(0);
  });

  it('повторный toggleTask возвращает статус задачи в незавершённый', () => {
    const state = createDefaultExecutiveOnboarding('Acme Corp', 'CTO');
    const taskId = state.tasks[0].id;

    const completed = toggleTask(state, taskId);
    expect(completed.tasks.find((t) => t.id === taskId)?.completed).toBe(true);

    const reopened = toggleTask(completed, taskId);
    expect(reopened.tasks.find((t) => t.id === taskId)?.completed).toBe(false);
  });

  it('добавляет цель KPI/OKR с привязкой к этапу', () => {
    const state = createDefaultExecutiveOnboarding('Acme Corp', 'VP Engineering');
    const updated = addGoal(state, {
      title: 'Снизить time-to-market на 20%',
      type: 'technical',
      targetDate: '2026-12-31',
    });

    expect(updated.goals.length).toBe(1);
    expect(updated.goals[0].title).toBe('Снизить time-to-market на 20%');
    expect(updated.goals[0].status).toBe('on_track');
  });

  it('добавляет квант опыта STAR для фиксации достижений', () => {
    const state = createDefaultExecutiveOnboarding('Acme Corp', 'CPO');
    const updated = addQuantum(state, {
      situation: 'Команда теряла 40% лидов на онбординге',
      action: 'Внедрил 3-шаговый мастер и валидацию данных на клиенте',
      result: 'Конверсия выросла до 78%, отток снизился в 2 раза',
    });

    expect(updated.quantums.length).toBe(1);
    expect(updated.quantums[0].result).toContain('Конверсия выросла');
  });

  it('формирует стратегические советы стратега под выбранный этап', () => {
    const advice30 = generateStageAdvice('days-30', 'Head of Product');
    expect(advice30.length).toBeGreaterThan(0);
    expect(advice30[0]).toContain('руководителем');

    const advice90 = generateStageAdvice('days-90', 'Head of Product');
    expect(advice90.length).toBeGreaterThan(0);
    expect(advice90.some((a) => a.includes('испытательного срока'))).toBe(true);
  });

  it('фильтр NDA блокирует и маскирует конфиденциальные данные (API-ключи, токены)', () => {
    const cleanText = 'Обсудили архитектурные цели на квартал со стейкхолдерами';
    const cleanResult = sanitizeWorkplaceInput(cleanText);
    expect(cleanResult.safe).toBe(true);
    expect(cleanResult.sanitizedText).toBe(cleanText);

    const secretText = 'Наш ключ sk-proj-1234567890abcdef1234567890 и токен Bearer eyJhbGciOi';
    const secretResult = sanitizeWorkplaceInput(secretText);
    expect(secretResult.safe).toBe(false);
    expect(secretResult.warning).toBeDefined();
    expect(secretResult.sanitizedText).toContain('[СКРЫТО]');
  });
});
