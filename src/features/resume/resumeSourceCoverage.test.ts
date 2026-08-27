import { describe, expect, it } from 'vitest';
import { resumeSourceCoverage, importedSourceOf } from './resumeSourceCoverage';
import type { ImportedSourceSummary } from '../coach/coachApi';
import type { ResumeDraft } from './resumeTypes';

const EMPTY: ResumeDraft = {
  candidate: {},
  experience: [],
  skills: [],
  education: [],
  courses: [],
  tests: [],
  recommendations: [],
  languages: [],
};

function source(overrides: Partial<ImportedSourceSummary> = {}): ImportedSourceSummary {
  return {
    platform: 'hh',
    connectedAt: '2026-08-26T10:00:00.000Z',
    lastImportedAt: '2026-08-27T09:30:00.000Z',
    factCount: 10,
    ...overrides,
  };
}

describe('resumeSourceCoverage', () => {
  it('calls every section empty when the import brought nothing', () => {
    const coverage = resumeSourceCoverage(EMPTY);

    expect(coverage.filled).toEqual([]);
    expect(coverage.empty.map((section) => section.label)).toEqual([
      'Имя',
      'Контакты',
      'Целевая роль',
      'Опыт работы',
      'Навыки',
      'Образование',
      'Языки',
      'Курсы',
      'Тесты',
      'Рекомендации',
    ]);
  });

  /**
   * The owner's report: hh.ru holds a name, a city and languages but no work
   * history at all, and Resume Studio said nothing about either half (B172).
   */
  it('separates what the source filled from what it never held', () => {
    const coverage = resumeSourceCoverage({
      ...EMPTY,
      candidate: {
        fullName: 'Елена Тарасова',
        contact: { location: 'Белград', links: [] },
      },
      skills: [{ id: 'skill-1', name: 'Управление командой' }],
      languages: [{ id: 'lang-1', evidenceMemoryId: 'memory-1', name: 'Русский', cefr: 'C2' }],
    });

    expect(coverage.filled.map((section) => section.label)).toEqual([
      'Имя',
      'Контакты',
      'Навыки',
      'Языки',
    ]);
    expect(coverage.empty.map((section) => section.label)).toContain('Опыт работы');
    expect(coverage.filled.find((section) => section.label === 'Навыки')?.count).toBe(1);
    expect(coverage.filled.find((section) => section.label === 'Имя')?.count).toBeNull();
  });

  it('counts a contact block filled by any single detail', () => {
    for (const contact of [
      { email: 'candidate@example.com', links: [] },
      { phone: '+00 000 000 00 00', links: [] },
      { location: 'Белград', links: [] },
      { links: ['https://example.com/profile'] },
    ]) {
      const coverage = resumeSourceCoverage({ ...EMPTY, candidate: { contact } });
      expect(coverage.filled.map((section) => section.label)).toContain('Контакты');
    }
  });
});

describe('importedSourceOf', () => {
  it('has no source to name until a platform has imported', () => {
    expect(importedSourceOf([])).toBeUndefined();
    expect(importedSourceOf(undefined)).toBeUndefined();
  });

  it('names the platform that imported last when both are connected', () => {
    const named = importedSourceOf([
      source(),
      source({
        platform: 'linkedin',
        lastImportedAt: '2026-08-27T11:00:00.000Z',
        factCount: 3,
      }),
    ]);

    expect(named?.label).toBe('LinkedIn');
    expect(named?.factCount).toBe(3);
    expect(named?.importedAt).toBe('2026-08-27T11:00:00.000Z');
  });
});
