import { describe, expect, it } from 'vitest';
import { analyzeJobFit, type VacancyTarget } from '../jobFitAnalyzer';
import type { ResumeDraft } from '../../features/resume/resumeTypes';

describe('jobFitAnalyzer', () => {
  const candidateDraft: ResumeDraft = {
    candidate: {
      fullName: 'Мария Иванова',
      about: 'Технический лидер с опытом руководства распределенными командами 40+ инженеров.',
      contact: {
        location: 'Москва',
        links: ['https://hh.ru/resume/marina-orlova-qa'],
      },
    },
    targetRole: 'VP of Engineering / Head of Tech',
    experience: [
      {
        id: 'exp-1',
        chronologyMemoryId: 'mem-exp-1',
        title: 'VP of Engineering',
        employer: 'Fintech Group',
        current: true,
        startDate: '2021-01',
        bulletMemoryIds: ['bullet-1', 'bullet-2'],
      },
    ],
    skills: [
      { id: 's-1', name: 'TypeScript' },
      { id: 's-2', name: 'Node.js' },
      { id: 's-3', name: 'PostgreSQL' },
      { id: 's-4', name: 'Architecture' },
      { id: 's-5', name: 'Team Leadership' },
    ],
    education: [
      {
        id: 'edu-1',
        evidenceMemoryId: 'mem-edu-1',
        institution: 'МГТУ им. Н.Э. Баумана',
        qualification: 'Инженер',
      },
    ],
    languages: [
      { id: 'l-1', evidenceMemoryId: 'mem-l-1', name: 'Русский' },
      { id: 'l-2', evidenceMemoryId: 'mem-l-2', name: 'Английский', cefr: 'C1' },
    ],
  };

  it('calculates comprehensive job-fit breakdown with high match for relevant vacancy', () => {
    const vacancy: VacancyTarget = {
      id: 'vac-1',
      title: 'Head of Engineering / VP Tech',
      company: 'Digital Bank',
      description: 'Ищем Head of Engineering для управления разработкой платформы на TypeScript, Node.js, PostgreSQL. Требуется опыт лидерства от 5 лет.',
      requiredSkills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Team Leadership', 'Architecture'],
      preferredSkills: ['Kubernetes', 'Go'],
      seniority: 'Lead/Executive',
      domain: 'Fintech',
    };

    const fit = analyzeJobFit(candidateDraft, vacancy);

    expect(fit.overallScore).toBeGreaterThanOrEqual(80);
    expect(fit.hardSkillsMatch.score).toBeGreaterThanOrEqual(70);
    expect(fit.hardSkillsMatch.matched).toContain('TypeScript');
    expect(fit.hardSkillsMatch.matched).toContain('Node.js');
    expect(fit.softSkillsMatch.score).toBeGreaterThanOrEqual(75);
    expect(fit.seniorityMatch.score).toBeGreaterThanOrEqual(80);
    expect(fit.domainMatch.score).toBeGreaterThanOrEqual(80);
    expect(fit.atsScore).toBeGreaterThanOrEqual(80);
    expect(fit.verdict).toContain('Сильное соответствие');
  });

  it('identifies skill gaps when key requirements are missing', () => {
    const vacancy: VacancyTarget = {
      id: 'vac-2',
      title: 'AI Platform Architect',
      company: 'AI Labs',
      description: 'Требуется глубокий опыт Python, PyTorch, LangChain, Kubernetes и MLOps.',
      requiredSkills: ['Python', 'PyTorch', 'LangChain', 'MLOps', 'Kubernetes'],
      seniority: 'Lead',
      domain: 'AI/ML',
    };

    const fit = analyzeJobFit(candidateDraft, vacancy);

    expect(fit.overallScore).toBeLessThan(60);
    expect(fit.hardSkillsMatch.missing).toContain('Python');
    expect(fit.hardSkillsMatch.missing).toContain('PyTorch');
    expect(fit.gaps.length).toBeGreaterThan(0);
  });
});
