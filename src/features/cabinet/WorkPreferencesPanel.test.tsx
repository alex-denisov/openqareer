import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkPreferencesPanel } from './WorkPreferencesPanel';
import type { WorkPreferencesState } from './useWorkPreferences';
import {
  scoreWorkPreferences,
  WORK_FAMILIES,
  WORK_PREFERENCE_KEY_VERSION,
  WORK_PREFERENCE_TASKS,
  DEFAULT_DECISION_PROFILE,
  type CandidateDecisionProfile,
} from '../../../shared/workPreferences';

const separating = [
  { taskId: 'monday', optionId: 'monday-queue' },
  { taskId: 'shift', optionId: 'shift-schedule' },
  { taskId: 'end-of-shift', optionId: 'end-of-shift-schedule' },
  { taskId: 'half-done', optionId: 'half-done-finish' },
  { taskId: 'week', optionId: 'week-build' },
  { taskId: 'worse', optionId: 'worse-research-nothing' },
  { taskId: 'day-done', optionId: 'day-done-numbers' },
  { taskId: 'explain', optionId: 'explain-form' },
  { taskId: 'people', optionId: 'people-grow' },
  { taskId: 'easier', optionId: 'easier-touch' },
  { taskId: 'one-hour', optionId: 'one-hour-persuade' },
  { taskId: 'first-day', optionId: 'first-day-open' },
];

function state(overrides: Partial<WorkPreferencesState> = {}): WorkPreferencesState {
  return {
    read: {
      keyVersion: WORK_PREFERENCE_KEY_VERSION,
      tasks: WORK_PREFERENCE_TASKS,
      families: [...WORK_FAMILIES],
      maxExcluded: 2,
      run: null,
    },
    loading: false,
    failed: false,
    saving: false,
    error: null,
    decisionProfile: DEFAULT_DECISION_PROFILE,
    decisionProfileSaved: false,
    submit: async () => true,
    saveDecisionProfile: async () => true,
    updateDecisionProfile: async () => true,
    resetDecisionProfile: async () => true,
    ...overrides,
  };
}

describe('WorkPreferencesPanel', () => {
  it('вопрос стоит о ролях, а подпись обещает порядок, а не оценку', () => {
    const markup = renderToStaticMarkup(<WorkPreferencesPanel state={state()} />);

    expect(markup).toContain('Какие роли мне подходят');
    expect(markup).toContain('12 коротких задач');
    expect(markup).toContain('Уточним порядок ролей, а не оценим вас');
    expect(markup).toContain('Правильных ответов здесь нет');
    // Слов об оценке человека здесь быть не может.
    expect(markup).not.toContain('балл');
    expect(markup).not.toContain('уровень');
  });

  it('пройденные задания печатает числами со знаменателями, без сводного балла', () => {
    const read = state().read;
    if (!read) return;
    const markup = renderToStaticMarkup(
      <WorkPreferencesPanel
        state={state({
          read: {
            ...read,
            run: {
              keyVersion: WORK_PREFERENCE_KEY_VERSION,
              result: scoreWorkPreferences({ answers: separating, excluded: [] }),
              completedAt: '2026-09-03T16:00:00.000Z',
            },
          },
        })}
      />,
    );

    expect(markup).toContain('12 выборов');
    expect(markup).toContain('когда это предлагалось');
    expect(markup).toContain('Порядок и поток');
  });

  it('отказ различить показывает словами, а не пустым списком', () => {
    const read = state().read;
    if (!read) return;
    const markup = renderToStaticMarkup(
      <WorkPreferencesPanel
        state={state({
          read: {
            ...read,
            run: {
              keyVersion: WORK_PREFERENCE_KEY_VERSION,
              // По одному выбору в три разных семейства: краёв нет.
              result: scoreWorkPreferences({
                answers: [
                  { taskId: 'monday', optionId: 'monday-queue' },
                  { taskId: 'half-done', optionId: 'half-done-finish' },
                  { taskId: 'day-done', optionId: 'day-done-numbers' },
                ],
                excluded: [],
              }),
              completedAt: '2026-09-03T16:00:00.000Z',
            },
          },
        })}
      />,
    );

    expect(markup).toContain('не разделили направления');
  });

  it('поломку маршрута не выдаёт за «заданий нет»', () => {
    const markup = renderToStaticMarkup(
      <WorkPreferencesPanel state={state({ read: null, failed: true })} />,
    );
    expect(markup).toContain('не удалось прочитать');
    expect(markup).not.toContain('Пройти задания');
  });

  describe('Профиль ограничений кандидата (US-03.3 / B384)', () => {
    it('отображает блок профиля ограничений с пометкой конфиденциальности и полями', () => {
      const markup = renderToStaticMarkup(<WorkPreferencesPanel state={state()} />);

      // Заголовок и пометка конфиденциальности
      expect(markup).toContain('Профиль ограничений');
      expect(markup).toContain('Конфиденциально');
      expect(markup).toContain('личный фильтр');

      // Поля ограничений
      expect(markup).toContain('Зарплатный пол');
      expect(markup).toContain('Гражданство');
      expect(markup).toContain('Формат работы');
      expect(markup).toContain('Подтверждённые языки');
      expect(markup).toContain('Финансовая подушка');

      // Форматы работы
      expect(markup).toContain('Домашний рынок');
      expect(markup).toContain('Удалёнка из РФ');
      expect(markup).toContain('Удалёнка из-за рубежа');
      expect(markup).toContain('Офис');
      expect(markup).toContain('Релокация');

      // Разъяснение о влиянии зарплатного пола
      expect(markup).toContain('ниже этого порога');
      expect(markup).toContain('Пустые поля не ограничивают');

      // Кнопка сохранения
      expect(markup).toContain('Сохранить ограничения');
    });

    it('отражает заполненные значения зарплатного пола и форматов работы', () => {
      const profile: CandidateDecisionProfile = {
        ...DEFAULT_DECISION_PROFILE,
        salaryFloor: 220_000,
        salaryCurrency: 'RUB',
        citizenship: ['РФ'],
        workFormats: ['remote_home', 'relocation'],
        cushionMonths: 6,
        hasFamily: true,
      };

      const markup = renderToStaticMarkup(
        <WorkPreferencesPanel state={state({ decisionProfile: profile })} />,
      );

      expect(markup).toContain('220000');
      expect(markup).toContain('РФ');
      expect(markup).toContain('6');
    });

    it('показывает статус «Ограничения сохранены» при флаге decisionProfileSaved', () => {
      const markup = renderToStaticMarkup(
        <WorkPreferencesPanel state={state({ decisionProfileSaved: true })} />,
      );
      expect(markup).toContain('Ограничения сохранены');
    });

    it('пустые поля не вызывают ошибок и позволяют сохранить профиль', () => {
      const markup = renderToStaticMarkup(
        <WorkPreferencesPanel state={state({ decisionProfile: DEFAULT_DECISION_PROFILE })} />,
      );
      expect(markup).not.toContain('Ошибка');
      expect(markup).toContain('Сохранить ограничения');
    });
  });
});
