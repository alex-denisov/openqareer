import { describe, expect, it } from 'vitest';
import { detectVacancyWorkFormat } from '../../shared/vacancyWorkFormat';
import { buildBlockCCatalog } from './block-c-catalog';

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
