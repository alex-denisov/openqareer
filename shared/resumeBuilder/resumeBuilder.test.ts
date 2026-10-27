import { describe, expect, it } from 'vitest';
import { assessBuilderResume, matchKeywords } from './ats';
import {
  builderResumeSchema,
  compactBuilderResume,
  EMPTY_BUILDER_RESUME,
  isBlankBuilderResume,
  SAMPLE_BUILDER_RESUME,
} from './model';
import { builderResumeText } from './text';

describe('resume builder model (B567)', () => {
  it('accepts the sample and drops blank form rows', () => {
    expect(builderResumeSchema.safeParse(SAMPLE_BUILDER_RESUME).success).toBe(true);
    const compact = compactBuilderResume({
      ...SAMPLE_BUILDER_RESUME,
      results: ['', 'Итог'],
      jobs: [...SAMPLE_BUILDER_RESUME.jobs, { ...EMPTY_BUILDER_RESUME.jobs[0] }],
    });
    expect(compact.results).toEqual(['Итог']);
    expect(compact.jobs).toHaveLength(2);
  });

  it('knows an untouched form from a started one', () => {
    expect(isBlankBuilderResume(EMPTY_BUILDER_RESUME)).toBe(true);
    expect(isBlankBuilderResume({ ...EMPTY_BUILDER_RESUME, title: 'Бухгалтер' })).toBe(false);
  });

  it('writes the profile text in the strict section order', () => {
    const text = builderResumeText(SAMPLE_BUILDER_RESUME);
    expect(text.indexOf('Опыт работы')).toBeLessThan(text.indexOf('Образование'));
    expect(text.indexOf('Образование')).toBeLessThan(text.indexOf('Навыки'));
    expect(text).toContain('Главный бухгалтер, ООО «Северный терминал»');
    expect(text).toContain('03.2021 — сейчас');
  });
});

describe('builder ATS check (B567)', () => {
  it('passes structure, dates and format on the sample and waits for a vacancy on keywords', () => {
    const result = assessBuilderResume(SAMPLE_BUILDER_RESUME);
    expect(result.passed).toBe(3);
    expect(result.total).toBe(4);
    expect(result.checks.find((check) => check.id === 'keywords')?.status).toBe('needs_vacancy');
  });

  it('names the job whose dates have no month', () => {
    const resume = {
      ...SAMPLE_BUILDER_RESUME,
      jobs: [{ ...SAMPLE_BUILDER_RESUME.jobs[1], start: '2017', end: '2021' }],
    };
    const dates = assessBuilderResume(resume).checks.find((check) => check.id === 'dates');
    expect(dates?.status).toBe('fix');
    expect(dates?.detail).toContain('АО «Инвестстрой»');
  });

  it('lists missing sections', () => {
    const structure = assessBuilderResume(EMPTY_BUILDER_RESUME).checks[0];
    expect(structure.status).toBe('fix');
    expect(structure.detail).toContain('опыт');
  });

  it('compares vacancy keywords case- and ё-insensitively', () => {
    const match = matchKeywords(SAMPLE_BUILDER_RESUME, ['мсфо', '1С:ERP', 'SAP', 'налоговыи учет']);
    expect(match.present).toEqual(['мсфо', '1С:ERP']);
    expect(match.missing).toEqual(['SAP', 'налоговыи учет']);
    const keywords = assessBuilderResume(SAMPLE_BUILDER_RESUME, ['МСФО', 'SAP']).checks[1];
    expect(keywords.status).toBe('fix');
    expect(keywords.detail).toBe('Есть 1 из 2. Нет: SAP.');
  });
});
