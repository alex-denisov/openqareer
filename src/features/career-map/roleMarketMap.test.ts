import { describe, expect, it } from 'vitest';
import type { EvidenceItem, RoleHypothesis } from '../evidence/evidenceEngine';
import { buildRoleMarketMap } from './roleMarketMap';

const evidence: EvidenceItem[] = [
  {
    id: 'ev-01',
    kind: 'responsibility',
    sourceExcerpt: 'Управлял продуктовой и проектной командами.',
    statement: 'Управлял продуктовой и проектной командами.',
    status: 'confirmed',
    userEdited: false,
  },
];

function role(id: string, title: string): RoleHypothesis {
  return {
    id,
    title,
    fitState: 'adjacent',
    basis: 'Гипотеза опирается на подтверждённую ответственность.',
    evidenceIds: ['ev-01'],
    gaps: ['Нужно проверить уровень на рынке.'],
  };
}

describe('role and market map', () => {
  it('keeps several testable role hypotheses for an unclear direction', () => {
    const map = buildRoleMarketMap({
      roleHypotheses: [
        role('role-ops', 'Operations Lead'),
        role('role-program', 'Program Manager'),
        role('role-product-ops', 'Product Operations Lead'),
        role('role-fourth', 'COO'),
      ],
      evidence,
      markets: [],
    });

    expect(map.roles).toHaveLength(3);
    expect(map.roles.every((item) => item.evidenceRefs.length > 0)).toBe(true);
    expect(map.roles.every((item) => item.nextExperiment.length > 0)).toBe(true);
  });

  it('does not merge Product and Project role hypotheses', () => {
    const map = buildRoleMarketMap({
      roleHypotheses: [
        role('role-product', 'Product Manager'),
        role('role-project', 'Project Manager'),
      ],
      evidence,
      markets: [],
    });

    expect(map.roles.map((item) => item.title)).toEqual([
      'Product Manager',
      'Project Manager',
    ]);
  });

  it('keeps Russia, relocation and worldwide remote as separate routes', () => {
    const map = buildRoleMarketMap(
      {
        roleHypotheses: [role('role-ops', 'Operations Lead')],
        evidence,
        markets: [
          {
            id: 'ru',
            geography: 'russia',
            label: 'Россия',
            workMode: 'hybrid',
            observations: [],
          },
          {
            id: 'de',
            geography: 'relocation',
            label: 'Германия с релокацией',
            countryCode: 'DE',
            workMode: 'hybrid',
            observations: [],
          },
          {
            id: 'remote',
            geography: 'worldwide-remote',
            label: 'Удалённо по миру',
            workMode: 'remote',
            observations: [],
          },
        ],
      },
      '2026-08-07T00:00:00.000Z',
    );

    expect(map.markets.map((item) => item.geography)).toEqual([
      'russia',
      'relocation',
      'worldwide-remote',
    ]);
  });

  it('shows dated stale and insufficient market evidence as unknown', () => {
    const map = buildRoleMarketMap(
      {
        roleHypotheses: [role('role-ops', 'Operations Lead')],
        evidence,
        markets: [
          {
            id: 'de',
            geography: 'relocation',
            label: 'Германия',
            countryCode: 'DE',
            workMode: 'hybrid',
            observations: [
              {
                id: 'vac-1',
                roleTitle: 'Operations Lead',
                observedAt: '2025-11-01T00:00:00.000Z',
                sourceLabel: 'Company careers',
                requirements: ['German B2'],
              },
            ],
          },
        ],
      },
      '2026-08-07T00:00:00.000Z',
    );

    expect(map.markets[0]).toMatchObject({
      sampleStatus: 'stale',
      certainty: 'unknown',
      sampleSize: 1,
      lastObservedAt: '2025-11-01T00:00:00.000Z',
    });
    expect(map.nextExperiment.reason).toContain('свеж');
  });
});
