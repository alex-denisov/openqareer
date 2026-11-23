import { describe, expect, it } from 'vitest';
import { scoreInterviewAnswer } from './interviewSimulator';
import { buildSystemDesignTask, SYSTEM_DESIGN_TIME_LIMIT_MINUTES } from './systemDesignTask';

describe('buildSystemDesignTask', () => {
  it('builds the task from the saved vacancy description', () => {
    const task = buildSystemDesignTask({
      vacancyTitle: 'Senior Go-разработчик',
      company: 'Арка Пэй',
      description: 'Команда биллинга: платежи и возвраты. Стек: Go, Kafka, PostgreSQL, Kubernetes.',
    });
    expect(task.basis).toBe('vacancy');
    expect(task.domain).toBe('payments');
    expect(task.timeLimitMinutes).toBe(45);
    expect(SYSTEM_DESIGN_TIME_LIMIT_MINUTES).toBe(45);
    expect(task.prompt).toContain('Спроектируйте сервис платежей');
    expect(task.title).toBe('Сервис платежей');
    expect(task.prompt).toContain('«Senior Go-разработчик»');
    expect(task.prompt).toContain('«Арка Пэй»');
    expect(task.stack).toEqual(['Go', 'Kafka', 'PostgreSQL']);
    expect(task.prompt).toContain('Go, Kafka, PostgreSQL');
    expect(task.hint.length).toBeGreaterThan(10);
  });

  it('picks the domain with the most keyword hits', () => {
    const task = buildSystemDesignTask({
      vacancyTitle: 'Backend',
      description: 'Доставка заказов курьерами, склад и логистика. Иногда пуш-уведомления.',
    });
    expect(task.domain).toBe('logistics');
  });

  it('falls back to the role family when the description has no domain', () => {
    const task = buildSystemDesignTask({
      vacancyTitle: 'Инженер платформы',
      description: 'Дружная команда, ДМС.',
    });
    expect(task.basis).toBe('role');
    expect(task.domain).toBe('infra');
    expect(task.prompt).toContain('«Инженер платформы»');
  });

  it('B750: GenAI Architect — задача про LLM, четыре пункта, не «Основной API продукта»', () => {
    const task = buildSystemDesignTask({
      vacancyTitle: 'GenAI Architect',
      company: 'Himalayas',
      description:
        'We build generative AI products for enterprise clients. Remote, flexible hours.',
    });
    expect(task.domain).toBe('ml_genai');
    expect(task.points).toHaveLength(4);
    expect(task.title).not.toBe('Основной API продукта');
    expect(task.prompt).not.toContain('основной API продукта');
    expect(task.points.join(' ')).toMatch(/RAG|модел/u);
    expect(task.origin).toBe('rules');
  });

  it('B750: семья роли по названию', () => {
    const family = (vacancyTitle: string) => buildSystemDesignTask({ vacancyTitle }).domain;
    expect(family('Инженер данных')).toBe('data');
    expect(family('Data Scientist')).toBe('ml_genai');
    expect(family('Senior Frontend-разработчик')).toBe('frontend');
    expect(family('DevOps / SRE')).toBe('infra');
    expect(family('VP of Engineering')).toBe('management');
    expect(family('Руководитель разработки')).toBe('management');
    expect(family('Go-разработчик')).toBe('backend');
    expect(family('Менеджер по продажам')).toBe('core_api');
  });

  it('general task only without a domain and a role family', () => {
    const task = buildSystemDesignTask({ vacancyTitle: 'Специалист' });
    expect(task.title).toBe('Основной API продукта');
    expect(task.points).toHaveLength(4);
  });

  it('falls back to the role without a description', () => {
    expect(buildSystemDesignTask({ vacancyTitle: 'Тимлид' }).basis).toBe('role');
  });

  it('does not read the English word "go" as the Go language', () => {
    const task = buildSystemDesignTask({
      vacancyTitle: 'Dev',
      description: 'Ready to go. Search with Elasticsearch.',
    });
    expect(task.stack).toEqual(['Elasticsearch']);
    expect(task.domain).toBe('search');
  });

  it('gives an example answer that covers every system design criterion', () => {
    for (const description of [
      'платежи',
      'уведомления',
      'поиск',
      'маркетплейс',
      'чат',
      'аналитика',
      'доставка',
      '',
    ]) {
      const task = buildSystemDesignTask({ vacancyTitle: 'Роль', description });
      const score = scoreInterviewAnswer(task.exampleAnswer, 'system_design');
      expect(score.points, `${task.domain}`).toBe(score.maxPoints);
      expect(task.points, `${task.domain}`).toHaveLength(4);
    }
    for (const vacancyTitle of ['ML Engineer', 'Data Engineer', 'iOS', 'SRE', 'CTO', 'Java']) {
      const task = buildSystemDesignTask({ vacancyTitle });
      const score = scoreInterviewAnswer(task.exampleAnswer, 'system_design');
      expect(score.points, `${task.domain}`).toBe(score.maxPoints);
      expect(task.points, `${task.domain}`).toHaveLength(4);
    }
  });
});
