// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkPreferences, type WorkPreferencesState } from './useWorkPreferences';
import {
  DECISION_PROFILE_STORAGE_KEY,
  DECISION_PROFILE_SYNCED_KEY,
  DEFAULT_DECISION_PROFILE,
  type CandidateDecisionProfile,
} from '../../../shared/workPreferences';
import { SESSION_TOKEN_STORAGE_KEY } from '../coach/apiClient';

const api = vi.hoisted(() => ({
  getDecisionProfile: vi.fn(),
  getWorkPreferences: vi.fn(),
  putDecisionProfile: vi.fn(),
  submitWorkPreferences: vi.fn(),
}));

vi.mock('../coach/coachApi', () => api);

const roots: Root[] = [];
let state: WorkPreferencesState;

function Consumer() {
  state = useWorkPreferences();
  return null;
}

async function mountPreferences(): Promise<Root> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<Consumer />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return root;
}

function localProfile(overrides: Partial<CandidateDecisionProfile> = {}): CandidateDecisionProfile {
  return {
    ...DEFAULT_DECISION_PROFILE,
    citizenship: ['РФ'],
    salaryFloor: 250_000,
    ...overrides,
  };
}

describe('useWorkPreferences decision profile sync (B421)', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'session-b421-1');
    api.getDecisionProfile.mockReset().mockResolvedValue(null);
    api.getWorkPreferences.mockReset().mockResolvedValue({
      keyVersion: 'test',
      tasks: [],
      families: [],
      maxExcluded: 0,
      run: null,
    });
    api.putDecisionProfile.mockReset().mockResolvedValue(undefined);
    api.submitWorkPreferences.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    window.localStorage.clear();
  });

  it('sends a valid local profile once when the server is empty and marks it synced', async () => {
    const local = localProfile();
    window.localStorage.setItem(DECISION_PROFILE_STORAGE_KEY, JSON.stringify(local));

    await mountPreferences();

    expect(api.putDecisionProfile).toHaveBeenCalledTimes(1);
    expect(api.putDecisionProfile).toHaveBeenCalledWith(
      expect.objectContaining({ citizenship: ['РФ'], salaryFloor: 250_000 }),
    );
    expect(window.localStorage.getItem(DECISION_PROFILE_SYNCED_KEY)).toBe('1');
  });

  it('does not send the profile again after a successful sync and remount', async () => {
    window.localStorage.setItem(DECISION_PROFILE_STORAGE_KEY, JSON.stringify(localProfile()));
    await mountPreferences();
    await mountPreferences();

    expect(api.putDecisionProfile).toHaveBeenCalledTimes(1);
  });

  it('replaces local data with the server profile without sending a PUT', async () => {
    const local = localProfile({ salaryFloor: 100_000 });
    const remote = localProfile({ salaryFloor: 400_000, workFormats: ['office'] });
    window.localStorage.setItem(DECISION_PROFILE_STORAGE_KEY, JSON.stringify(local));
    api.getDecisionProfile.mockResolvedValue(remote);

    await mountPreferences();

    expect(api.putDecisionProfile).not.toHaveBeenCalled();
    expect(state.decisionProfile.salaryFloor).toBe(400_000);
    expect(
      JSON.parse(window.localStorage.getItem(DECISION_PROFILE_STORAGE_KEY) ?? '{}').salaryFloor,
    ).toBe(400_000);
  });

  it('leaves failures unmarked and retries with the next login without showing an error', async () => {
    window.localStorage.setItem(DECISION_PROFILE_STORAGE_KEY, JSON.stringify(localProfile()));
    api.putDecisionProfile.mockRejectedValueOnce(new Error('offline'));
    await mountPreferences();

    expect(window.localStorage.getItem(DECISION_PROFILE_SYNCED_KEY)).toBeNull();
    expect(state.error).toBeNull();

    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'session-b421-2');
    await mountPreferences();

    expect(api.putDecisionProfile).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(DECISION_PROFILE_SYNCED_KEY)).toBe('1');
    expect(state.error).toBeNull();
  });

  it('ignores an invalid local profile without sending it', async () => {
    window.localStorage.setItem(
      DECISION_PROFILE_STORAGE_KEY,
      JSON.stringify({ ...localProfile(), salaryFloor: -1 }),
    );

    await mountPreferences();

    expect(api.putDecisionProfile).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DECISION_PROFILE_SYNCED_KEY)).toBeNull();
  });
});
