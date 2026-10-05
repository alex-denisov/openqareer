// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkPreferences, type WorkPreferencesState } from './useWorkPreferences';
import {
  DEFAULT_DECISION_PROFILE,
  DECISION_PROFILE_STORAGE_KEY,
  type CandidateDecisionProfile,
} from '../../../shared/workPreferences';

describe('useWorkPreferences', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('инициализирует decisionProfile значениями по умолчанию при чистом хранилище', async () => {
    let state!: WorkPreferencesState;
    function Consumer() {
      state = useWorkPreferences();
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<Consumer />));

    expect(state.decisionProfile).toEqual(DEFAULT_DECISION_PROFILE);
    await act(async () => root.unmount());
  });

  it('загружает ранее сохранённый профиль ограничений из хранилища', async () => {
    const saved: CandidateDecisionProfile = {
      ...DEFAULT_DECISION_PROFILE,
      citizenship: ['РФ'],
      salaryFloor: 250_000,
      salaryCurrency: 'RUB',
      cushionMonths: 6,
    };
    window.localStorage.setItem(DECISION_PROFILE_STORAGE_KEY, JSON.stringify(saved));

    let state!: WorkPreferencesState;
    function Consumer() {
      state = useWorkPreferences();
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<Consumer />));

    expect(state.decisionProfile.salaryFloor).toBe(250_000);
    expect(state.decisionProfile.citizenship).toEqual(['РФ']);
    expect(state.decisionProfile.cushionMonths).toBe(6);
    await act(async () => root.unmount());
  });

  it('saveDecisionProfile сохраняет профиль в стейт и в хранилище', async () => {
    let state!: WorkPreferencesState;
    function Consumer() {
      state = useWorkPreferences();
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<Consumer />));

    const next: CandidateDecisionProfile = {
      ...DEFAULT_DECISION_PROFILE,
      salaryFloor: 180_000,
      workFormats: ['remote_home', 'office'],
    };

    await act(async () => {
      const ok = await state.saveDecisionProfile(next);
      expect(ok).toBe(true);
    });

    expect(state.decisionProfile.salaryFloor).toBe(180_000);
    expect(state.decisionProfile.workFormats).toEqual(['remote_home', 'office']);

    const inStorage = JSON.parse(window.localStorage.getItem(DECISION_PROFILE_STORAGE_KEY) ?? '{}');
    expect(inStorage.salaryFloor).toBe(180_000);
    await act(async () => root.unmount());
  });
});
