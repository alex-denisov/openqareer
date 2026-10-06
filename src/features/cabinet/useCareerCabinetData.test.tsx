// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccount, getCandidate } from '../coach/coachApi';
import { getResumeStudio } from '../resume/resumeApi';
import type { AccountSnapshot, CandidateSnapshot } from '../coach/coachApi';
import {
  clearCareerCabinetCache,
  readCareerCabinetCache,
  writeCareerCabinetCache,
} from './careerCabinetCache';
import { useCareerCabinetData } from './useCareerCabinetData';

vi.mock('../coach/coachApi', () => ({
  getAccount: vi.fn(),
  getCandidate: vi.fn(),
}));

vi.mock('../resume/resumeApi', () => ({
  getResumeStudio: vi.fn(),
}));

const CANDIDATE_ID = 'candidate-b426';

function account(username: string): AccountSnapshot {
  return {
    username,
    email: null,
    displayName: null,
    profile: {
      headline: null,
      location: null,
      workMode: null,
      updatedAt: null,
    },
    sessions: [],
  };
}

function snapshot(candidateId: string, statement: string): CandidateSnapshot {
  return {
    candidate: {
      id: candidateId,
      dataClass: 'synthetic',
      locale: 'ru-RU',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    messages: [],
    memory: [
      {
        id: statement,
        kind: 'fact',
        domain: 'skill',
        statement,
        confidence: 'candidate-confirmed',
        sourceMessageIds: [],
        sensitive: false,
        status: 'confirmed',
      },
    ],
    turns: [],
    dossier: {
      sections: [],
      confirmedCount: 0,
      proposedCount: 0,
      readiness: { complete: false, unresolvedQuestions: 0, checks: [] },
    },
    assessments: [],
    germanyMarket: null,
    resume: {
      draft: null,
      createdAt: null,
      updatedAt: null,
    },
  } as CandidateSnapshot;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mount(candidateId: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Consumer() {
    const data = useCareerCabinetData(candidateId);
    return (
      <div>
        <span data-testid="account">{data.account?.username ?? ''}</span>
        <span data-testid="profile">{data.snapshot?.memory[0]?.statement ?? ''}</span>
        <span data-testid="loading">{String(data.loading)}</span>
      </div>
    );
  }
  return {
    host,
    render: async () => act(async () => root.render(<Consumer />)),
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function text(host: HTMLElement, name: string): string {
  return host.querySelector(`[data-testid="${name}"]`)?.textContent ?? '';
}

describe('useCareerCabinetData', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getResumeStudio).mockRejectedValue(new Error('resume unavailable'));
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('shows the cached profile immediately and replaces it with the fresh response', async () => {
    const freshAccount = deferred<AccountSnapshot>();
    const freshSnapshot = deferred<CandidateSnapshot>();
    vi.mocked(getAccount).mockReturnValue(freshAccount.promise);
    vi.mocked(getCandidate).mockReturnValue(freshSnapshot.promise);
    writeCareerCabinetCache(sessionStorage, CANDIDATE_ID, {
      account: account('cached-candidate'),
      snapshot: snapshot(CANDIDATE_ID, 'cached skill'),
    });

    const mounted = mount(CANDIDATE_ID);
    await mounted.render();

    expect(text(mounted.host, 'account')).toBe('cached-candidate');
    expect(text(mounted.host, 'profile')).toBe('cached skill');
    expect(text(mounted.host, 'loading')).toBe('false');

    await act(async () => {
      freshAccount.resolve(account('fresh-candidate'));
      freshSnapshot.resolve(snapshot(CANDIDATE_ID, 'fresh skill'));
    });

    expect(text(mounted.host, 'account')).toBe('fresh-candidate');
    expect(text(mounted.host, 'profile')).toBe('fresh skill');
    await mounted.unmount();
  });

  it('starts independent profile requests in parallel', async () => {
    vi.mocked(getAccount).mockReturnValue(new Promise(() => undefined));
    vi.mocked(getCandidate).mockReturnValue(new Promise(() => undefined));

    const mounted = mount(CANDIDATE_ID);
    await mounted.render();

    expect(getAccount).toHaveBeenCalledTimes(1);
    expect(getCandidate).toHaveBeenCalledTimes(1);
    expect(getResumeStudio).toHaveBeenCalledTimes(1);
    await mounted.unmount();
  });

  it('clears candidate profile caches on sign-out', () => {
    const value = {
      account: account('candidate'),
      snapshot: snapshot(CANDIDATE_ID, 'cached skill'),
    };
    writeCareerCabinetCache(sessionStorage, CANDIDATE_ID, value);
    expect(readCareerCabinetCache(sessionStorage, 'different-candidate')).toBeUndefined();
    sessionStorage.setItem('unrelated-session-value', 'keep');

    clearCareerCabinetCache(sessionStorage);

    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem('unrelated-session-value')).toBe('keep');
  });
});
