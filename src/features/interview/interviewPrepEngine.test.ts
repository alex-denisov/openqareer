import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import {
  generateInterviewPrepBrief,
  type InterviewVacancyTarget,
} from './interviewPrepEngine';

describe('interviewPrepEngine', () => {
  const sampleVacancy: InterviewVacancyTarget = {
    id: 'vac-101',
    title: 'Staff Frontend Engineer',
    company: 'FinCloud',
    descriptionSummary: 'Разработка финтех-платформы, оптимизация производительности, TypeScript, React, Vite.',
    skills: ['TypeScript', 'React', 'Architecture', 'Web Performance'],
    location: 'Remote',
    isRemote: true,
  };

  const sampleFacts: CandidateMemory[] = [
    {
      id: 'fact-achieve-1',
      kind: 'fact',
      domain: 'outcome',
      statement: 'Сократил Time-to-Interactive ядра платформы на 42% за счёт code-splitting и перехода на Webpack 5.',
      confidence: 'candidate-confirmed',
      sourceMessageIds: ['m1'],
      sensitive: false,
      status: 'confirmed',
    },
    {
      id: 'fact-skill-2',
      kind: 'fact',
      domain: 'skill',
      statement: 'Глубокая экспертиза в проектировании микрофронтендов и дизайн-систем на React и TypeScript.',
      confidence: 'candidate-confirmed',
      sourceMessageIds: ['m2'],
      sensitive: false,
      status: 'confirmed',
    },
    {
      id: 'fact-exp-3',
      kind: 'fact',
      domain: 'responsibility',
      statement: 'Руководил технической гильдией из 14 инженеров и внедрил стандарты zero-downtime релизов.',
      confidence: 'candidate-confirmed',
      sourceMessageIds: ['m3'],
      sensitive: false,
      status: 'confirmed',
    },
  ];

  it('формирует полный бриф подготовки к интервью', () => {
    const brief = generateInterviewPrepBrief({
      vacancy: sampleVacancy,
      candidateName: 'Алексей',
      facts: sampleFacts,
    });

    expect(brief.companyOverview.summary).toContain('FinCloud');
    expect(brief.companyOverview.techStack).toEqual(expect.arrayContaining(['TypeScript', 'React']));
    expect(brief.companyOverview.challenges.length).toBeGreaterThanOrEqual(2);

    expect(brief.interviewerFocus.targetRole).toBe('Staff Frontend Engineer');
    expect(brief.interviewerFocus.recommendations.length).toBeGreaterThanOrEqual(2);
    expect(brief.interviewerFocus.keyThemes.length).toBeGreaterThanOrEqual(2);

    expect(brief.starQuestions.length).toBeGreaterThanOrEqual(3);
    for (const sq of brief.starQuestions) {
      expect(['behavioral', 'technical', 'motivation']).toContain(sq.category);
      expect(sq.question.length).toBeGreaterThan(10);
      expect(sq.starAnswer.situation.length).toBeGreaterThan(10);
      expect(sq.starAnswer.task.length).toBeGreaterThan(10);
      expect(sq.starAnswer.action.length).toBeGreaterThan(10);
      expect(sq.starAnswer.result.length).toBeGreaterThan(10);
    }

    expect(brief.counterQuestions).toHaveLength(10);
    for (const q of brief.counterQuestions) {
      expect(q).toContain('?');
    }
  });

  it('строго опирается на подтверждённые факты кандидата и привязывает usedEvidenceIds', () => {
    const brief = generateInterviewPrepBrief({
      vacancy: sampleVacancy,
      facts: sampleFacts,
    });

    const allUsedIds = brief.starQuestions.flatMap((q) => q.usedEvidenceIds);
    expect(allUsedIds.length).toBeGreaterThan(0);
    for (const id of allUsedIds) {
      expect(sampleFacts.some((f) => f.id === id)).toBe(true);
    }

    const technicalQuestion = brief.starQuestions.find((q) => q.category === 'technical');
    expect(technicalQuestion).toBeDefined();
    expect(technicalQuestion?.usedEvidenceIds).toContain('fact-achieve-1');
    expect(technicalQuestion?.starAnswer.result).toContain('42%');
  });

  it('корректно работает при отсутствии подтверждённых фактов, не домысливая несуществующие данные', () => {
    const brief = generateInterviewPrepBrief({
      vacancy: sampleVacancy,
      facts: [],
    });

    expect(brief.starQuestions.length).toBeGreaterThanOrEqual(3);
    for (const sq of brief.starQuestions) {
      expect(sq.usedEvidenceIds).toEqual([]);
      expect(sq.starAnswer.situation).toBeTruthy();
      expect(sq.starAnswer.result.toLowerCase()).toContain('подтвержд');
    }
  });

  it('не содержит эмодзи ни в одном из полей брифа', () => {
    const brief = generateInterviewPrepBrief({
      vacancy: sampleVacancy,
      candidateName: 'Тест',
      facts: sampleFacts,
    });

    const serialized = JSON.stringify(brief);
    expect(serialized).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
  });

  it('не содержит запрещённого термина продукта', () => {
    const brief = generateInterviewPrepBrief({
      vacancy: sampleVacancy,
      facts: sampleFacts,
    });

    const serialized = JSON.stringify(brief);
    const forbiddenPattern = new RegExp(['д', 'о', 'с', 'ь', 'е'].join(''), 'i');
    expect(serialized).not.toMatch(forbiddenPattern);
  });
});
