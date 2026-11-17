import { describe, expect, it } from 'vitest';
import type { QuestionnaireQuestion } from '../../shared/applicationQuestionnaire';
import {
  buildQuestionnaire,
  parseGreenhouseQuestions,
  salarySuggestions,
} from './applicationQuestionnaire';

const GREENHOUSE = {
  questions: [
    { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text' }] },
    { label: 'Resume/CV', required: true, fields: [{ name: 'resume', type: 'input_file' }] },
    { label: 'Cover Letter', required: false, fields: [{ name: 'cover_letter_text', type: 'textarea' }] },
    {
      label: 'How many people were on your team?',
      required: true,
      fields: [{ name: 'question_101', type: 'textarea', values: [] }],
    },
    {
      label: 'Are you open to travel?',
      required: false,
      fields: [
        {
          name: 'question_102',
          type: 'multi_value_single_select',
          values: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }],
        },
      ],
    },
    { label: '  ', required: true, fields: [{ name: 'question_103', type: 'input_text' }] },
    { label: 'Upload portfolio', required: false, fields: [{ name: 'question_104', type: 'input_file' }] },
  ],
};

describe('B641: вопросы Greenhouse', () => {
  it('берёт только вопросы работодателя, без имени, резюме и файлов', () => {
    expect(parseGreenhouseQuestions(GREENHOUSE)).toEqual([
      { id: 'question_101', text: 'How many people were on your team?', required: true, kind: 'text' },
      {
        id: 'question_102',
        text: 'Are you open to travel?',
        required: false,
        kind: 'choice',
        options: ['Yes', 'No'],
      },
    ]);
  });

  it('вопрос с небезопасным идентификатором отбрасывается', () => {
    const field = (name: string) => ({ label: 'Q', required: false, fields: [{ name, type: 'input_text' }] });
    expect(
      parseGreenhouseQuestions({
        questions: [field('constructor x'), field('a b'), field('q"1'), field('question_7'), field('answers[0]')],
      }).map((question) => question.id),
    ).toEqual(['question_7', 'answers[0]']);
  });

  it('чужая форма ответа даёт пустой список, а не падение', () => {
    expect(parseGreenhouseQuestions(null)).toEqual([]);
    expect(parseGreenhouseQuestions({ questions: 'nope' })).toEqual([]);
    expect(parseGreenhouseQuestions({ questions: [null, { label: 1 }, { label: 'Q', fields: 'x' }] })).toEqual([]);
  });

  it('длинный текст и число вопросов ограничены', () => {
    const many = {
      questions: Array.from({ length: 60 }, (_, index) => ({
        label: `Вопрос ${index} ${'x'.repeat(600)}`,
        required: false,
        fields: [{ name: `question_${index}`, type: 'input_text' }],
      })),
    };
    const parsed = parseGreenhouseQuestions(many);
    expect(parsed).toHaveLength(40);
    expect(parsed[0].text.length).toBeLessThanOrEqual(500);
  });
});

const QUESTIONS: readonly QuestionnaireQuestion[] = [
  { id: 'q1', text: 'Сколько человек было в вашей команде?', required: true, kind: 'text' },
  { id: 'q2', text: 'Ожидаемый уровень дохода?', required: true, kind: 'text' },
  { id: 'q3', text: 'Готовы ли к командировкам?', required: false, kind: 'text' },
];

describe('B641: подсказка из профиля', () => {
  it('на вопрос о деньгах предлагает ожидания из профиля', () => {
    expect(salarySuggestions(QUESTIONS, { salaryFloor: 500000, salaryCurrency: 'RUB' })).toEqual([
      { questionId: 'q2', text: 'от 500 000 ₽', source: 'Ожидания из вашего профиля' },
    ]);
    expect(
      salarySuggestions([{ id: 's', text: 'What are your salary expectations?', required: true, kind: 'text' }], {
        salaryFloor: 7000,
        salaryCurrency: 'USD',
      })[0].text,
    ).toBe('от 7 000 $');
  });

  it('без ожиданий в профиле ничего не выдумывает', () => {
    expect(salarySuggestions(QUESTIONS, {})).toEqual([]);
    expect(salarySuggestions(QUESTIONS, null)).toEqual([]);
  });
});

describe('B641: готовность анкеты', () => {
  it('считает ответы и обязательные пропуски, чужие ответы отбрасывает', () => {
    const view = buildQuestionnaire({
      vacancyId: 'v1',
      state: 'ready',
      formUrl: 'https://boards.greenhouse.io/acme/jobs/1',
      questions: QUESTIONS,
      answers: [
        { questionId: 'q1', text: ' 9 человек ' },
        { questionId: 'q3', text: '   ' },
        { questionId: 'gone', text: 'x' },
      ],
      profile: { salaryFloor: 500000 },
      readAt: '2026-11-17T00:00:00.000Z',
      submittedAt: null,
    });
    // Ожидания по доходу из профиля уже стоят ответом, и у них назван источник.
    expect(view).toMatchObject({ answered: 2, total: 3, missingRequired: 0 });
    expect(view.answers).toEqual([
      { questionId: 'q1', text: '9 человек' },
      { questionId: 'q2', text: 'от 500 000 ₽' },
    ]);
    expect(view.suggestions).toEqual([
      { questionId: 'q2', text: 'от 500 000 ₽', source: 'Ожидания из вашего профиля' },
    ]);
  });

  it('источник исчезает, когда кандидат написал своё', () => {
    const view = buildQuestionnaire({
      vacancyId: 'v1',
      state: 'ready',
      formUrl: null,
      questions: QUESTIONS,
      answers: [{ questionId: 'q2', text: 'от 600 000 ₽' }],
      profile: { salaryFloor: 500000 },
      readAt: null,
      submittedAt: null,
    });
    expect(view.suggestions).toEqual([]);
  });

  it('без вопросов состояние не «готово»', () => {
    const view = buildQuestionnaire({
      vacancyId: 'v1', state: 'ready', formUrl: null, questions: [], answers: [], profile: null, readAt: null, submittedAt: null,
    });
    expect(view.state).toBe('none');
  });
});
