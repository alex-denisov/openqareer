import { describe, expect, it } from 'vitest';
import {
  coursesNotFoundLead,
  provenanceLabel,
  provenanceSourceValue,
  aboutProvenance,
  sourceCountLabel,
  walkHeadline,
} from './profileProvenance';

describe('profile provenance copy (B541, макет 2)', () => {
  it('says where a fact came from in the mockup words', () => {
    expect(
      provenanceLabel({ kind: 'import', platform: 'linkedin', at: '2026-09-12T08:00:00Z' }),
    ).toBe('из LinkedIn, 12.09');
    expect(provenanceLabel({ kind: 'import', platform: 'hh', at: '2026-10-07T08:00:00Z' })).toBe(
      'из hh.ru, 07.10',
    );
    expect(provenanceLabel({ kind: 'import', platform: 'file', at: '2026-10-01T08:00:00Z' })).toBe(
      'из файла резюме, 01.10',
    );
    expect(provenanceLabel({ kind: 'candidate', at: '2026-10-01T08:00:00Z' })).toBe(
      'со слов кандидата',
    );
    expect(provenanceLabel({ kind: 'consultant', at: '2026-10-06T08:00:00Z' })).toBe(
      'консультант 06.10',
    );
    expect(provenanceLabel(undefined)).toBe('источник неизвестен');
  });

  it('counts kept facts against the import', () => {
    expect(
      sourceCountLabel({ factCount: 9, keptFactCount: 8, lastImportedAt: '2026-10-07T08:00:00Z' }),
    ).toBe('8 из 9 · 07.10');
    expect(sourceCountLabel({ factCount: 9, lastImportedAt: '2026-10-07T08:00:00Z' })).toBe(
      '9 из 9 · 07.10',
    );
  });

  it('names only the platforms really imported in the courses note', () => {
    expect(coursesNotFoundLead([{ platform: 'linkedin' }, { platform: 'hh' }])).toBe(
      'Курсы не найдены ни в LinkedIn, ни в hh.ru.',
    );
    expect(coursesNotFoundLead([{ platform: 'hh' }])).toBe('Курсы не найдены в hh.ru.');
    expect(coursesNotFoundLead([])).toBe('Курсы пока не добавлены.');
  });

  it('reads the walk while it runs and after it ends', () => {
    const sections = [
      { key: 'experience', status: 'read' as const },
      { key: 'education', status: 'read' as const },
      { key: 'skills', status: 'read' as const },
      { key: 'languages', status: 'pending' as const },
      { key: 'projects', status: 'pending' as const },
      { key: 'courses', status: 'pending' as const },
      { key: 'contactInfo', status: 'pending' as const },
    ];
    expect(
      walkHeadline({
        platform: 'linkedin',
        state: 'running',
        updatedAt: '2026-10-20T08:00:00Z',
        sections,
      }),
    ).toBe('LinkedIn: читаем разделы, 3 из 7');
    expect(
      walkHeadline({
        platform: 'linkedin',
        state: 'done',
        updatedAt: '2026-10-20T08:00:00Z',
        sections,
      }),
    ).toBe('LinkedIn: прочитано 3 из 7, 20.10');
  });

  it('writes the 390 «Источник» value', () => {
    expect(
      provenanceSourceValue({ kind: 'import', platform: 'linkedin', at: '2026-09-12T08:00:00Z' }),
    ).toBe('LinkedIn, 12.09');
    expect(provenanceSourceValue({ kind: 'candidate', at: '' })).toBe('Со слов кандидата');
    expect(provenanceSourceValue(undefined)).toBe('Источник неизвестен');
  });

  it('names the origin of «Обо мне» from the draft, not from the words (B541)', () => {
    const imported = {
      id: 'imp1-about',
      kind: 'fact' as const,
      domain: 'other' as const,
      statement: 'Старый текст',
      confidence: 'candidate-reported' as const,
      sourceMessageIds: ['m'],
      sensitive: false,
      status: 'proposed' as const,
      provenance: { kind: 'import' as const, platform: 'hh' as const, at: '2026-10-07T08:00:00Z' },
    };
    expect(
      aboutProvenance({ about: 'Текст', aboutMemoryId: 'imp1-about' }, [imported]),
    ).toMatchObject({ kind: 'import', platform: 'hh' });
    expect(
      aboutProvenance(
        { about: 'Текст', aboutOrigin: { kind: 'consultant', at: '2026-10-06T08:00:00Z' } },
        [imported],
      ),
    ).toEqual({ kind: 'consultant', at: '2026-10-06T08:00:00Z' });
    expect(aboutProvenance({ about: 'Старый текст' }, [imported])).toMatchObject({
      kind: 'import',
    });
    expect(aboutProvenance({ about: 'Свой текст' }, [imported])).toMatchObject({
      kind: 'candidate',
    });
    expect(aboutProvenance({}, [imported])).toBeUndefined();
  });
});
