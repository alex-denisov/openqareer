import { describe, expect, it } from 'vitest';
import {
  resolveScreeningQuestion,
  buildHhApplicationPackage,
  type ScreeningQuestion,
} from '../hhApplicant';
import type { ResumeDraft } from '../../features/resume/resumeTypes';

describe('hhApplicant', () => {
  const sampleDraft: ResumeDraft = {
    candidate: {
      fullName: 'Алексей Денисов',
      contact: {
        email: 'alexey@example.com',
        phone: '+7 999 123-45-67',
        location: 'Москва',
        links: ['https://hh.ru/resume/test-resume-1'],
      },
      about: 'Опытный руководитель разработки и технологических операций.',
    },
    targetRole: 'VP of Engineering',
    experience: [
      {
        id: 'exp-1',
        chronologyMemoryId: 'mem-exp-1',
        title: 'VP of Engineering',
        employer: 'Tech Global',
        current: true,
        startDate: '2020-01',
        bulletMemoryIds: ['bullet-1', 'bullet-2'],
      },
    ],
    skills: [
      { id: 's-1', name: 'TypeScript' },
      { id: 's-2', name: 'React' },
      { id: 's-3', name: 'Node.js' },
      { id: 's-4', name: 'Team Leadership' },
    ],
    education: [
      {
        id: 'edu-1',
        evidenceMemoryId: 'mem-edu-1',
        institution: 'МГТУ им. Н.Э. Баумана',
        qualification: 'Информатика и системы управления',
      },
    ],
    languages: [
      { id: 'l-1', evidenceMemoryId: 'mem-l-1', name: 'Русский' },
      { id: 'l-2', evidenceMemoryId: 'mem-l-2', name: 'Английский', cefr: 'C1' },
    ],
  };

  it('resolves expected salary screening questions', () => {
    const question: ScreeningQuestion = {
      id: 'q-salary',
      text: 'Какой уровень заработной платы вы рассматриваете (на руки)?',
      type: 'text',
    };
    const resolved = resolveScreeningQuestion(question, sampleDraft);
    expect(resolved.answered).toBe(true);
    expect(resolved.value).toBeDefined();
  });

  it('resolves experience screening questions', () => {
    const question: ScreeningQuestion = {
      id: 'q-exp',
      text: 'Сколько лет у вас опыта руководства командами разработки?',
      type: 'text',
    };
    const resolved = resolveScreeningQuestion(question, sampleDraft);
    expect(resolved.answered).toBe(true);
    expect(resolved.confidence).toBe('high');
  });

  it('resolves location and work format questions', () => {
    const question: ScreeningQuestion = {
      id: 'q-format',
      text: 'Готовы ли вы работать в гибридном или удаленном формате?',
      type: 'single_choice',
      options: ['Да, готов к удаленному/гибридному формату', 'Только офис'],
    };
    const resolved = resolveScreeningQuestion(question, sampleDraft);
    expect(resolved.answered).toBe(true);
    expect(resolved.value).toContain('Да');
  });

  it('builds a complete application package with personalized cover letter', () => {
    const vacancy = {
      id: 'vac-101',
      title: 'Head of Engineering',
      company: 'Fintech Unicorn',
      description: 'Ищем опытного лидера с сильным бэкграундом в Node.js, TypeScript и архитектуре.',
      requiredSkills: ['Node.js', 'TypeScript', 'Team Leadership'],
    };

    const pkg = buildHhApplicationPackage(sampleDraft, vacancy, [
      {
        id: 'q-1',
        text: 'Ваш опыт работы с TypeScript?',
        type: 'text',
      },
    ]);

    expect(pkg.vacancyId).toBe('vac-101');
    expect(pkg.coverLetter).toContain('Fintech Unicorn');
    expect(pkg.coverLetter).toContain('Head of Engineering');
    expect(pkg.answers).toHaveLength(1);
    expect(pkg.status).toBe('ready_to_submit');
  });
});
