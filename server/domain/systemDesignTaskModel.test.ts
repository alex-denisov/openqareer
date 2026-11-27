import { describe, expect, it } from 'vitest';
import { scoreInterviewAnswer } from './interviewSimulator';
import { parseSystemDesignTask, systemDesignTaskUserMessage } from './systemDesignTaskModel';

const GENAI = {
  vacancyTitle: 'GenAI Architect',
  company: 'Himalayas',
  description:
    'Design LLM platform for enterprise clients: RAG over internal documents, evals, guardrails.',
  requirements: ['Опыт построения RAG-систем', 'Оценка качества LLM', 'Python, Kubernetes'],
};

const ANSWER = {
  title: 'Ассистент на LLM для 5 000 сотрудников',
  service: 'Сервис ответов по внутренним документам',
  scope: 'ответы сотрудникам по документам компании со ссылками на источники',
  points: [
    'Поиск по документам (RAG) и свежесть индекса',
    'Оценка качества ответов и защита от выдумок',
    'Права доступа к документам',
    'Задержка и стоимость вызовов модели.',
  ],
  requirements: 'сколько документов и пользователей, допустимая задержка ответа',
  components: 'загрузка документов, векторный индекс, сервис ответов, журнал оценок',
  tradeoff: 'малая модель на простые вопросы дешевле, большая — на сложные',
  operations: 'контрольный набор вопросов, лимиты расходов, запасная модель',
};

describe('B750 · задача System Design от модели', () => {
  it('вход — вакансия, требования и текст, без данных кандидата', () => {
    const message = systemDesignTaskUserMessage(GENAI);
    expect(message).toContain('Вакансия: GenAI Architect');
    expect(message).toContain('- Опыт построения RAG-систем');
    expect(message).toContain('RAG over internal documents');
  });

  it('годный ответ — задача из четырёх пунктов с образцом по всем критериям', () => {
    const task = parseSystemDesignTask(ANSWER, GENAI);
    expect(task).not.toBeNull();
    expect(task!.origin).toBe('model');
    expect(task!.basis).toBe('vacancy');
    expect(task!.domain).toBe('ml_genai');
    expect(task!.title).toBe('Ассистент на LLM для 5 000 сотрудников');
    expect(task!.points).toEqual([
      ...ANSWER.points.slice(0, 3),
      'Задержка и стоимость вызовов модели',
    ]);
    expect(task!.prompt).toContain(
      'Спроектируйте сервис ответов по внутренним документам для «GenAI Architect»',
    );
    // Стек — только из текста вакансии: Kubernetes есть лишь в требованиях.
    expect(task!.stack).toEqual([]);
    const score = scoreInterviewAnswer(task!.exampleAnswer, 'system_design');
    expect(score.points).toBe(score.maxPoints);
  });

  it('не четыре пункта, повтор, латиница или общая задача — null', () => {
    expect(
      parseSystemDesignTask({ ...ANSWER, points: ANSWER.points.slice(0, 3) }, GENAI),
    ).toBeNull();
    expect(
      parseSystemDesignTask(
        { ...ANSWER, points: [...ANSWER.points.slice(0, 3), ANSWER.points[0]] },
        GENAI,
      ),
    ).toBeNull();
    expect(parseSystemDesignTask({ ...ANSWER, title: 'LLM assistant' }, GENAI)).toBeNull();
    expect(parseSystemDesignTask({ ...ANSWER, title: 'Основной API продукта' }, GENAI)).toBeNull();
    expect(parseSystemDesignTask({ ...ANSWER, extra: 1 }, GENAI)).not.toBeNull();
    expect(parseSystemDesignTask(null, GENAI)).toBeNull();
  });
});
