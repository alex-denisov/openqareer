import { describe, expect, it } from 'vitest';
import { scoreInterviewAnswerWithQuotes } from './interviewAnswerReview';
import { scoreInterviewAnswer } from './interviewSimulator';
import {
  buildSystemDesignTask,
  detectStack,
  SYSTEM_DESIGN_TIME_LIMIT_MINUTES,
} from './systemDesignTask';

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
    expect(family('VP of Engineering')).toBe('leadership');
    expect(family('Руководитель разработки')).toBe('leadership');
    expect(family('Тимлид')).toBe('management');
    expect(family('Go-разработчик')).toBe('backend');
    expect(family('Менеджер по продажам')).toBe('work');
  });

  it('B635: руководящая роль — управленческий кейс, инженер вне ПО — рабочая задача', () => {
    for (const vacancyTitle of [
      'Технический директор / Ведущий инженер СЭС (СНЭ)',
      'Операционный директор (COO)',
      'Head of IT Infrastructure & Support',
    ]) {
      const task = buildSystemDesignTask({ vacancyTitle, description: 'Доставка и поиск' });
      expect(task.caseKind).toBe('leadership');
      expect(JSON.stringify(task)).not.toMatch(/сервис|архитектур|трафик|Kubernetes/iu);
      const score = scoreInterviewAnswerWithQuotes(task.exampleAnswer, 'system_design', 'leadership');
      expect(score.points).toBe(score.maxPoints);
    }
    const engineer = buildSystemDesignTask({ vacancyTitle: 'Инженер СЭС' });
    expect(engineer.caseKind).toBe('work');
    const score = scoreInterviewAnswerWithQuotes(engineer.exampleAnswer, 'system_design', 'work');
    expect(score.points).toBe(score.maxPoints);
    expect(
      buildSystemDesignTask({ vacancyTitle: 'Инженер', description: 'Микросервисы на Kafka' }).caseKind,
    ).toBe('system');
  });

  it('general task only without a domain and a role family', () => {
    const task = buildSystemDesignTask({ vacancyTitle: 'Специалист', description: 'Software' });
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
      const task = buildSystemDesignTask({ vacancyTitle: 'Backend', description });
      const score = scoreInterviewAnswer(task.exampleAnswer, 'system_design');
      expect(score.points, `${task.domain}`).toBe(score.maxPoints);
      expect(task.points, `${task.domain}`).toHaveLength(4);
    }
    for (const vacancyTitle of ['ML Engineer', 'Data Engineer', 'iOS', 'SRE', 'Тимлид', 'Java']) {
      const task = buildSystemDesignTask({ vacancyTitle });
      const score = scoreInterviewAnswer(task.exampleAnswer, 'system_design');
      expect(score.points, `${task.domain}`).toBe(score.maxPoints);
      expect(task.points, `${task.domain}`).toHaveLength(4);
    }
  });
});

describe('B741: стек задачи — «Go-to-market» не язык Go', () => {
  it('go-to-market и Go live не дают Go', () => {
    expect(detectStack('Go-to-market strategy, Go live in Q1, Kafka')).toEqual(['Kafka']);
  });
  it('«Go, Kubernetes» даёт Go', () => {
    expect(detectStack('Go, Kubernetes')).toEqual(['Go', 'Kubernetes']);
  });
});
