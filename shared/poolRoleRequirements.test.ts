import { describe, expect, it } from 'vitest';
import { describeGroup, groupObservations, type RoleObservation } from './poolRoleHypotheses';

const vacancy = (skills: string[]): RoleObservation => ({
  canonicalTitle: 'VP of Operations',
  firstObservedAt: '2026-11-20T00:00:00.000Z',
  skills,
  sources: [{ sourceType: 'hh' }],
});

describe('B747: название отдела — не требование роли', () => {
  it('«Operations» и «Engineering» не попадают в требования, навыки остаются', () => {
    const pool = Array.from({ length: 4 }, () =>
      vacancy(['Operations', 'Engineering', 'Операционная эффективность', 'OKR / KPI']),
    );
    const [group] = groupObservations(pool).values();
    const role = describeGroup(group, new Set(), new Set());
    expect(role.repeatedRequirements).toEqual(['OKR / KPI', 'Операционная эффективность']);
  });
});
