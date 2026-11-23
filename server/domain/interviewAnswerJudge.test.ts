import { describe, expect, it } from 'vitest';
import { scoreInterviewAnswerWithQuotes } from './interviewAnswerReview';
import {
  acceptJudgement,
  judgeInstructions,
  judgeJsonSchema,
  mergeJudgement,
} from './interviewAnswerJudge';

/** Пять эталонных ответов: ясный STAR, слабый, выдуманная цитата, System Design, сломанный ответ модели. */
const KUBERNETES =
  'В 2023 году я руководил переводом платёжного сервиса в Kubernetes. Цель — убрать ночные простои при выпуске. ' +
  'Я разбил переход на четыре этапа, договорился с бизнесом об окнах и вёл команду из 12 человек. ' +
  'Время выпуска сократилось с 4 часов до 20 минут.';
const WEAK = 'Мы что-то делали с сервисом, в целом получилось нормально.';
const DESIGN =
  'Переносим без остановки продукта: сначала двойная запись. Несколько команд договариваются через контракты API. ' +
  'Порядок переноса — от чтения к записи, у каждого шага есть точка отката. Метрики: задержка p95 и доля ошибок.';
const TASK_POINTS = [
  'Без остановки продукта',
  'Несколько команд и контракты API',
  'Порядок переноса и точки отката',
  'Метрики успеха',
];

const verdict = (points: 0 | 1 | 2, reason: string, quote: string | null) => ({
  points,
  reason,
  quote,
});

describe('B780: критерии ответа оценивает модель, «есть» — с цитатой из ответа', () => {
  it('1) ясный STAR-ответ: все четыре «есть» с цитатами, хотя слов «сделал/внедрил» нет', () => {
    const judged = acceptJudgement(
      {
        situation: verdict(
          2,
          'Роль ясна: руководили переводом',
          'я руководил переводом платёжного сервиса в Kubernetes',
        ),
        task: verdict(2, 'Цель и критерий названы', 'Цель — убрать ночные простои при выпуске'),
        action: verdict(2, 'Свои шаги: этапы, бизнес, команда', 'Я разбил переход на четыре этапа'),
        result: verdict(2, 'Результат в числах', 'Время выпуска сократилось с 4 часов до 20 минут'),
      },
      { type: 'behavioral', answer: KUBERNETES },
    );
    const merged = mergeJudgement(scoreInterviewAnswerWithQuotes(KUBERNETES, 'behavioral'), judged);
    expect(Object.values(merged.criteria).map((criterion) => criterion.points)).toEqual([
      2, 2, 2, 2,
    ]);
    expect(merged.points).toBe(8);
    expect(merged.criteria.action).toEqual({
      points: 2,
      reason: 'Свои шаги: этапы, бизнес, команда',
      quote: 'Я разбил переход на четыре этапа',
    });
  });

  it('2) слабый ответ: «уточнить» и «добавить» несут конкретную подсказку модели', () => {
    const judged = acceptJudgement(
      {
        situation: verdict(1, 'Назовите проект и вашу роль в нём', null),
        task: verdict(0, 'Скажите, какую цель ставили', null),
        action: verdict(0, 'Опишите, что сделали лично вы', null),
        result: verdict(1, 'Добавьте, что изменилось в цифрах', 'в целом получилось нормально'),
      },
      { type: 'behavioral', answer: WEAK },
    );
    const merged = mergeJudgement(scoreInterviewAnswerWithQuotes(WEAK, 'behavioral'), judged);
    expect(merged.criteria.action).toEqual({ points: 0, reason: 'Опишите, что сделали лично вы' });
    expect(merged.criteria.result?.quote).toBe('в целом получилось нормально');
  });

  it('3) «есть» с цитатой, которой нет в ответе, не принимается: решают правила', () => {
    const judged = acceptJudgement(
      {
        situation: verdict(2, 'Роль ясна', 'я руководил переводом платёжного сервиса в Kubernetes'),
        task: verdict(2, 'Цель названа', 'мы снизили стоимость инфраструктуры вдвое'),
        action: verdict(2, 'Шаги', 'Я разбил переход на четыре этапа'),
        result: verdict(2, 'Числа', 'сократилось с 4 часов до 20 минут'),
      },
      { type: 'behavioral', answer: KUBERNETES },
    );
    expect(judged?.task).toBeUndefined();
    const rules = scoreInterviewAnswerWithQuotes(KUBERNETES, 'behavioral');
    expect(mergeJudgement(rules, judged).criteria.task).toEqual(rules.criteria.task);
  });

  it('4) i03: «Требования» сверяются с пунктами «Что важно в задаче»', () => {
    const instructions = judgeInstructions({
      type: 'system_design',
      question: 'Перенесите монолит на сервисы',
      answer: DESIGN,
      taskPoints: TASK_POINTS,
    });
    for (const point of TASK_POINTS) expect(instructions).toContain(point);
    const judged = acceptJudgement(
      {
        requirements: verdict(
          2,
          'Все четыре пункта задачи учтены',
          'Переносим без остановки продукта',
        ),
        architecture: verdict(1, 'Назовите сервисы и потоки данных между ними', null),
        tradeoffs: verdict(0, 'Сравните двойную запись с другим вариантом', null),
        operations: verdict(2, 'Метрики и откат названы', 'Метрики: задержка p95 и доля ошибок'),
      },
      { type: 'system_design', answer: DESIGN },
    );
    const merged = mergeJudgement(scoreInterviewAnswerWithQuotes(DESIGN, 'system_design'), judged);
    expect(merged.criteria.requirements).toEqual({
      points: 2,
      reason: 'Все четыре пункта задачи учтены',
      quote: 'Переносим без остановки продукта',
    });
    expect(judgeJsonSchema('system_design').schema.required).toEqual([
      'requirements',
      'architecture',
      'tradeoffs',
      'operations',
    ]);
  });

  it('5) сломанный ответ модели — целиком правила', () => {
    expect(acceptJudgement('not json', { type: 'behavioral', answer: KUBERNETES })).toBeNull();
    expect(
      acceptJudgement(
        { situation: { points: 5, reason: '', quote: null } },
        { type: 'behavioral', answer: KUBERNETES },
      ),
    ).toBeNull();
    const rules = scoreInterviewAnswerWithQuotes(KUBERNETES, 'behavioral');
    expect(mergeJudgement(rules, null)).toBe(rules);
  });

  it('правила без модели: «руководил, разбил, договорился, вёл» — это личные действия', () => {
    const rules = scoreInterviewAnswerWithQuotes(KUBERNETES, 'behavioral');
    expect(rules.criteria.action?.points).toBe(2);
    expect(rules.criteria.situation?.points).toBeGreaterThan(0);
  });
});
