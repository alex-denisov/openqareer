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

  it('falls back to the role when the description has no domain', () => {
    const task = buildSystemDesignTask({
      vacancyTitle: 'Инженер платформы',
      description: 'Дружная команда, ДМС.',
    });
    expect(task.basis).toBe('role');
    expect(task.domain).toBe('core_api');
    expect(task.prompt).toContain('«Инженер платформы»');
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
    }
  });
});
