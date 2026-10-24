import { it, expect } from 'vitest';
import { relatedSalaryMarkets } from './salaryMarketRoutes';
import type {
  SalaryMarketIndexEntry,
  SalaryMarketSnapshot,
} from '../../shared/salaryMarketSnapshot';
it('joins explicit ontology adjacency to actual published paths without guessing siblings', () => {
  const source = {
    role: 'frontend',
    profession: { kind: 'b267', roleId: 'eng.frontend.ic' },
  } as SalaryMarketSnapshot;
  const entry = (role: string, roleId: string, indexable = true): SalaryMarketIndexEntry => ({
    role,
    roleLabel: role,
    sampleSize: 20,
    indexable,
    updatedAt: '2026-10-24T00:00:00Z',
    profession: { kind: 'b267', roleId },
  });
  expect(
    relatedSalaryMarkets(source, [
      entry('actual-backend-path', 'eng.backend.ic'),
      entry('unpublished-lead', 'eng.frontend.lead', false),
      entry('unrelated', 'eng.fullstack.ic'),
      entry('frontend', 'eng.frontend.ic'),
    ]).map((row) => row.role),
  ).toEqual(['actual-backend-path']);
  expect(
    relatedSalaryMarkets({ ...source, profession: { kind: 'unclassified_title' } }, [
      entry('actual-backend-path', 'eng.backend.ic'),
    ]),
  ).toEqual([]);
});
