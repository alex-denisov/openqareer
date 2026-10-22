import { describe, expect, it } from 'vitest';
import { detectVacancyWorkFormat } from '../../shared/vacancyWorkFormat';
import { extractVacancyRequirements } from '../../server/domain/vacancyRequirements';
import { labelVacancyRequirement } from '../../server/domain/vacancyRequirementLabel';
import { BLOCK_C_LONG_REQUIREMENT_ROWS, buildBlockCCatalog } from './block-c-catalog';

describe('B553: формат работы в текстах стенда блока C', () => {
  const rows = [...buildBlockCCatalog(new Date('2026-10-07T09:12:00Z')).values()].flat();
  // Сервер читает формат из первых 300 знаков описания (descriptionSummary).
  const formatOf = (row: (typeof rows)[number]) =>
    detectVacancyWorkFormat({
      location: row.location,
      summary: (row.description ?? '').slice(0, 300),
      isRemote: row.isRemote,
    });

  it('«Гео» строки макета читается как «Москва, гибрид»', () => {
    const vector = rows.find((row) => row.id === 'bc-vector-head-payments');
    expect(vector && formatOf(vector)).toBe('hybrid');
  });

  it('в выдаче есть гибрид, офис и удалёнка, и ни одной строки без формата', () => {
    const formats = new Set(rows.map(formatOf));
    expect(formats).toEqual(new Set(['hybrid', 'office', 'remote']));
  });
});

describe('B510: длинные англоязычные требования, как на проде', () => {
  const rows = [...buildBlockCCatalog(new Date('2026-10-07T09:12:00Z')).values()].flat();
  it('строки с длинными требованиями дают короткие чипы или не дают их вовсе', () => {
    const long = rows.filter((row) => BLOCK_C_LONG_REQUIREMENT_ROWS.has(row.id));
    expect(long.length).toBeGreaterThanOrEqual(3);
    for (const row of long) {
      const { requirements } = extractVacancyRequirements({
        vacancyId: row.id,
        description: row.description,
      });
      expect(requirements.some((item) => item.text.length > 80)).toBe(true);
      const labels = requirements
        .map(labelVacancyRequirement)
        .flatMap((item) => (item.label ? [item.label] : []));
      expect(labels).toEqual(expect.arrayContaining(['Kafka', 'Kubernetes']));
      for (const label of labels) expect(label.split(/\s+/u).length).toBeLessThanOrEqual(5);
    }
  });
});
