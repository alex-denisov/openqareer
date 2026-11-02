import { describe, expect, it, vi } from 'vitest';
import { readRoleKeywords, readVacancyKeywords, MAX_ROLE_LOOKUPS } from './atsRequirementSources';
import type { RouteDeps } from './deps';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

function cacheOf(labelsById: Record<string, string[]>) {
  const getLatestOrLegacy = vi.fn((id: string) => {
    const labels = labelsById[id];
    if (!labels) return null;
    return {
      vacancyId: id,
      status: 'extracted',
      requirements: labels.map((label, index) => ({
        id: String(index),
        text: label,
        sourceQuote: label,
        kind: 'other',
        label,
        skill: true,
      })),
    };
  });
  const deps = { vacancyMechanics: { requirements: { getLatestOrLegacy } } } as unknown as RouteDeps;
  return { deps, getLatestOrLegacy };
}

function item(id: string, title: string, roleMatch: 'none' | 'exact' = 'exact'): MatchedVacancyItem {
  return {
    cluster: { id, canonicalTitle: title },
    explanation: { roleMatch },
  } as unknown as MatchedVacancyItem;
}

describe('readRoleKeywords', () => {
  it('builds keywords from cached requirements of the role vacancies only', async () => {
    const { deps, getLatestOrLegacy } = cacheOf({
      a: ['Kafka', 'Управление командой'],
      b: ['Kafka', 'Team management'],
      c: ['Kafka'],
      x: ['Photoshop', 'Photoshop'],
    });
    const result = await readRoleKeywords(
      deps,
      [
        item('a', 'VP of Engineering'),
        item('b', 'VP of Engineering'),
        item('c', 'VP of Engineering'),
        item('x', 'Дизайнер'),
        item('y', 'VP of Engineering', 'none'),
      ],
      'VP of Engineering',
    );
    expect(result.vacanciesCounted).toBe(3);
    expect(result.keywords).toHaveLength(2);
    expect(result.keywords[0]).toBe('Kafka');
    expect(getLatestOrLegacy).not.toHaveBeenCalledWith('x');
    expect(getLatestOrLegacy).not.toHaveBeenCalledWith('y');
  });

  it('reads a bounded number of vacancies', async () => {
    const { deps, getLatestOrLegacy } = cacheOf({});
    const many = Array.from({ length: MAX_ROLE_LOOKUPS + 50 }, (_, i) => item(`v${i}`, 'CTO'));
    await readRoleKeywords(deps, many, 'CTO');
    expect(getLatestOrLegacy).toHaveBeenCalledTimes(MAX_ROLE_LOOKUPS);
  });

  it('is empty without the requirements runtime', async () => {
    const result = await readRoleKeywords({} as RouteDeps, [item('a', 'CTO')], 'CTO');
    expect(result).toEqual({ keywords: [], vacanciesCounted: 0 });
  });
});

describe('readVacancyKeywords', () => {
  it('returns the cached requirements of one vacancy, or null when none are cached', () => {
    const { deps } = cacheOf({ a: ['Kafka', 'Terraform'] });
    expect(readVacancyKeywords(deps, 'a')).toEqual(['Kafka', 'Terraform']);
    expect(readVacancyKeywords(deps, 'missing')).toBeNull();
  });
});
