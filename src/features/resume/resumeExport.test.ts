import { describe, expect, it } from 'vitest';
import type { ResumeDocument } from './resumeTypes';
import { exportResumeAsJson, exportResumeAsPlainText, resumeExportFileName } from './resumeExport';

function minimalDocument(overrides?: Partial<ResumeDocument>): ResumeDocument {
  return {
    kind: 'master',
    targetRole: null,
    contact: {
      fullName: null,
      email: null,
      phone: null,
      telegram: null,
      location: null,
      links: [],
    },
    about: null,
    photoUrl: null,
    experience: [],
    skills: [],
    education: [],
    courses: [],
    tests: [],
    recommendations: [],
    languages: [],
    additional: null,
    unknowns: [],
    conventions: {
      country: null,
      packVersion: null,
      reverseChronological: true,
      maxPages: null,
      recommendedBulletsPerRole: null,
      photo: 'omitted',
      discriminatoryPii: 'omitted',
    },
    length: { lines: 0, pages: 1, linesPerPage: 45 },
    ...overrides,
  };
}

describe('resumeExport', () => {
  it('formats an empty document into minimal safe text without crashing', () => {
    const doc = minimalDocument();
    const text = exportResumeAsPlainText(doc);
    expect(text).toBe('');
  });

  it('generates a clean ATS text representation with contacts and sections', () => {
    const doc = minimalDocument({
      contact: {
        fullName: 'Алексей Смирнов',
        email: 'alex@example.com',
        phone: '+7 999 123-45-67',
        telegram: '@alexsmirnov',
        location: 'Москва',
        links: [],
      },
      about: 'Опытный технический лидер с фокусом на масштабирование инфраструктуры.',
      targetRole: 'Head of Infrastructure / Lead DevOps',
      experience: [
        {
          id: 'exp-1',
          title: { value: 'Lead DevOps Engineer', memoryId: 'm-6', sourceMessageIds: [], reviewFlags: [] },
          employer: { value: 'TechCorp', memoryId: 'm-7', sourceMessageIds: [], reviewFlags: [] },
          location: { value: 'Москва', memoryId: 'm-8', sourceMessageIds: [], reviewFlags: [] },
          startDate: { value: '2021', memoryId: 'm-9', sourceMessageIds: [], reviewFlags: [] },
          endDate: null,
          current: { value: true, memoryId: 'm-10', sourceMessageIds: [], reviewFlags: [] },
          bullets: [
            { value: 'Сократил время деплоя с 45 до 8 минут.', memoryId: 'm-11', sourceMessageIds: [], reviewFlags: [] },
            { value: 'Внедрил Kubernetes кластер на 120 нод.', memoryId: 'm-12', sourceMessageIds: [], reviewFlags: [] },
          ],
        },
      ],
      education: [
        {
          id: 'edu-1',
          institution: { value: 'МГТУ им. Баумана', memoryId: 'm-13', sourceMessageIds: [], reviewFlags: [] },
          qualification: { value: 'Информатика и вычислительная техника', memoryId: 'm-14', sourceMessageIds: [], reviewFlags: [] },
          startDate: { value: '2012', memoryId: 'm-15', sourceMessageIds: [], reviewFlags: [] },
          endDate: { value: '2018', memoryId: 'm-16', sourceMessageIds: [], reviewFlags: [] },
        },
      ],
      skills: [{ id: 's-1', name: 'Kubernetes' }, { id: 's-2', name: 'Terraform' }, { id: 's-3', name: 'Go' }],
      languages: [
        {
          id: 'lang-1',
          name: { value: 'Английский', memoryId: 'm-17', sourceMessageIds: [], reviewFlags: [] },
          cefr: { value: 'C1', memoryId: 'm-18', sourceMessageIds: [], reviewFlags: [] },
        },
      ],
    });

    const text = exportResumeAsPlainText(doc);

    expect(text).toContain('АЛЕКСЕЙ СМИРНОВ');
    expect(text).toContain('Head of Infrastructure / Lead DevOps');
    expect(text).toContain('alex@example.com');
    expect(text).toContain('+7 999 123-45-67');
    expect(text).toContain('@alexsmirnov');
    expect(text).toContain('Москва');
    expect(text).toContain('ОБО МНЕ');
    expect(text).toContain('Опытный технический лидер');
    expect(text).toContain('ОПЫТ РАБОТЫ');
    expect(text).toContain('Lead DevOps Engineer — TechCorp');
    expect(text).toContain('2021 — настоящее время');
    expect(text).toContain('- Сократил время деплоя с 45 до 8 минут.');
    expect(text).toContain('- Внедрил Kubernetes кластер на 120 нод.');
    expect(text).toContain('ОБРАЗОВАНИЕ');
    expect(text).toContain('МГТУ им. Баумана');
    expect(text).toContain('Информатика и вычислительная техника');
    expect(text).toContain('НАВЫКИ');
    expect(text).toContain('Kubernetes, Terraform, Go');
    expect(text).toContain('ЯЗЫКИ');
    expect(text).toContain('Английский (C1)');
  });

  it('exports structured JSON with indentation', () => {
    const doc = minimalDocument({ targetRole: 'Backend Engineer' });
    const json = exportResumeAsJson(doc);
    const parsed = JSON.parse(json);
    expect(parsed.targetRole).toBe('Backend Engineer');
    expect(parsed.kind).toBe('master');
  });

  it('builds a safe file name slug with variant and name', () => {
    const doc = minimalDocument({
      contact: {
        fullName: 'Иван Иванов',
        email: null,
        phone: null,
        telegram: null,
        location: null,
        links: [],
      },
      kind: 'country-role',
    });

    const txtName = resumeExportFileName(doc, 'txt');
    expect(txtName).toBe('resume-germany-ivan-ivanov.txt');

    const jsonName = resumeExportFileName(doc, 'json');
    expect(jsonName).toBe('resume-germany-ivan-ivanov.json');
  });
});
