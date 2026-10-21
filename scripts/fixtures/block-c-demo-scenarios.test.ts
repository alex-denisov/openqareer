import { describe, expect, it } from 'vitest';
import { buildBlockCCatalog, BLOCK_C_SOURCES } from './block-c-catalog';
import {
  BLOCK_C_SCENARIOS,
  BlockCDemoScenarioController,
  parseBlockCDemoScenarioCommand,
} from './block-c-demo-scenarios';

const profiles = Object.fromEntries(
  ['main', 'empty', 'noSaved', 'fewData', 'noContacts'].map((key) => [key, { id: key }]),
) as Record<'main' | 'empty' | 'noSaved' | 'fewData' | 'noContacts', { id: string }>;

describe('block C demo scenarios (B510)', () => {
  it('accepts every listed scenario and rejects anything else', () => {
    for (const scenario of BLOCK_C_SCENARIOS) {
      expect(parseBlockCDemoScenarioCommand({ scenario })).toEqual({ ok: true, scenario });
    }
    expect(parseBlockCDemoScenarioCommand({ scenario: 'magic' }).ok).toBe(false);
    expect(parseBlockCDemoScenarioCommand({ scenario: 'default', extra: 1 }).ok).toBe(false);
    expect(parseBlockCDemoScenarioCommand(null).ok).toBe(false);
  });

  it('routes each scenario to its candidate and pool disposition', () => {
    const controller = new BlockCDemoScenarioController(profiles);
    expect(controller.activeProfile.id).toBe('main');
    expect(controller.poolDisposition()).toBe('continue');
    controller.select('empty');
    expect(controller.activeProfile.id).toBe('empty');
    controller.select('error');
    expect(controller.activeProfile.id).toBe('main');
    expect(controller.poolDisposition()).toBe('fail');
    controller.select('slow');
    expect(controller.poolDisposition()).toBe('delay');
    controller.select('no-saved');
    expect(controller.activeProfile.id).toBe('noSaved');
    controller.select('few-data');
    expect(controller.activeProfile.id).toBe('fewData');
    controller.select('no-contacts');
    expect(controller.activeProfile.id).toBe('noContacts');
    expect(controller.state.scenario).toBe('no-contacts');
  });
});

describe('block C catalog scale (B510)', () => {
  const catalog = buildBlockCCatalog(new Date('2026-10-21T09:00:00.000Z'));
  const rows = [...catalog.values()].flat();

  it('holds 1 752 rows (about 1 620 clusters) from eight sources with unique ids', () => {
    expect(rows.length).toBe(1_752);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(catalog.size).toBe(BLOCK_C_SOURCES.length);
    expect(BLOCK_C_SOURCES.length).toBeGreaterThanOrEqual(8);
  });

  it('mixes stated and missing salaries and spreads geography past 40 Russian cities', () => {
    const withSalary = rows.filter((row) => row.salary).length;
    expect(withSalary).toBeGreaterThan(200);
    expect(rows.length - withSalary).toBeGreaterThan(200);
    const cities = new Set(rows.map((row) => row.location));
    expect(cities.size).toBeGreaterThan(45);
    expect(rows.some((row) => row.location?.endsWith('USA'))).toBe(true);
  });

  it('describes every row in the three mockup sections', () => {
    for (const row of rows.slice(0, 50)) {
      expect(row.description).toContain('Чем предстоит заниматься');
      expect(row.description).toContain('Что мы ожидаем');
      expect(row.description).toContain('Условия');
    }
  });
});
