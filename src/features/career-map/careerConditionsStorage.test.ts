import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCompanyToStopList,
  CareerConditionsStorage,
  decisionProfileToSearchConditions,
  rejectRoleHypothesis,
  restoreRejectedRole,
  searchConditionsToDecisionProfile,
} from './careerConditionsStorage';
import { DEFAULT_SEARCH_CONDITIONS } from './careerMockData';

describe('careerConditionsStorage (B445 Criterion 2, 4)', () => {
  let storage: CareerConditionsStorage;

  beforeEach(() => {
    storage = new CareerConditionsStorage();
  });

  it('initializes with default conditions', () => {
    const conditions = storage.getConditions();
    expect(conditions.salaryFrom.amountRubles).toBe(450000);
    expect(conditions.geography.selected).toContain('Москва');
  });

  it('saves conditions and recalculates matching stats', async () => {
    const updated = await storage.saveConditions({
      ...DEFAULT_SEARCH_CONDITIONS,
      salaryFrom: { amountRubles: 500000, showWithoutSalary: false },
    });
    expect(updated.salaryFrom.amountRubles).toBe(500000);
    expect(updated.salaryFrom.showWithoutSalary).toBe(false);
    expect(updated.matchingStats.matched).toBeLessThan(
      DEFAULT_SEARCH_CONDITIONS.matchingStats.matched,
    );
  });

  it('handles save error honestly without losing field value', async () => {
    storage.simulateNetworkFailure(true);
    let errorCaught = false;
    try {
      await storage.saveConditions({
        ...DEFAULT_SEARCH_CONDITIONS,
        salaryFrom: { amountRubles: 600000, showWithoutSalary: true },
      });
    } catch (err: unknown) {
      errorCaught = true;
      expect((err as Error).message).toBe(
        'Не сохранилось: нет связи с сервером. Значение осталось в поле.',
      );
    }
    expect(errorCaught).toBe(true);
    // Draft value is kept in storage pending state
    expect(storage.getDraftConditions().salaryFrom.amountRubles).toBe(600000);
    // Committed server value was not corrupted
    expect(storage.getConditions().salaryFrom.amountRubles).toBe(450000);
  });

  it('allows rollback of uncommitted edit', () => {
    storage.setDraftConditions({
      ...DEFAULT_SEARCH_CONDITIONS,
      salaryFrom: { amountRubles: 700000, showWithoutSalary: true },
    });
    expect(storage.getDraftConditions().salaryFrom.amountRubles).toBe(700000);
    storage.rollbackDraft();
    expect(storage.getDraftConditions().salaryFrom.amountRubles).toBe(450000);
  });

  it('rejects a role and allows undo', () => {
    const rejected = rejectRoleHypothesis(new Set(), 'dir');
    expect(rejected.has('dir')).toBe(true);
    const restored = restoreRejectedRole(rejected, 'dir');
    expect(restored.has('dir')).toBe(false);
  });

  it('adds company to stop list manually', () => {
    const list = addCompanyToStopList(DEFAULT_SEARCH_CONDITIONS.stopList, 'Яндекс');
    expect(list).toHaveLength(3);
    expect(list[2].name).toBe('Яндекс');
    expect(list[2].origin).toBe('добавлено вручную');
  });

  it('maps CandidateDecisionProfile to SearchConditionsDraft and vice versa', () => {
    const profile = {
      citizenship: ['Санкт-Петербург'],
      taxStatus: '',
      languages: [],
      workFormats: ['remote_home', 'home_market'] as const,
      salaryFloor: 550000,
      salaryCurrency: 'RUB',
    };

    const draft = decisionProfileToSearchConditions(profile);
    expect(draft.salaryFrom.amountRubles).toBe(550000);
    expect(draft.geography.selected).toEqual(['Санкт-Петербург']);
    expect(draft.format.remote).toBe(true);
    expect(draft.format.hybrid).toBe(true);
    expect(draft.format.office).toBe(false);

    const backToProfile = searchConditionsToDecisionProfile(draft, profile);
    expect(backToProfile.salaryFloor).toBe(550000);
    expect(backToProfile.citizenship).toEqual(['Санкт-Петербург']);
    expect(backToProfile.workFormats).toContain('remote_home');
    expect(backToProfile.workFormats).toContain('home_market');
  });
});

