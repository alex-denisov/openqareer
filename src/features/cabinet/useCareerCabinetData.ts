import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import {
  CoachApiError,
  getAccount,
  getCandidate,
  type AccountSnapshot,
  type CandidateSnapshot,
} from '../coach/coachApi';
import { getResumeStudio } from '../resume/resumeApi';
import type { ResumeStudioView } from '../resume/resumeTypes';
import {
  readCareerCabinetCache,
  writeCareerCabinetCache,
} from './careerCabinetCache';

export interface CareerCabinetData {
  account?: AccountSnapshot;
  snapshot?: CandidateSnapshot;
  /** Undefined while loading or when the resume API is unreachable. */
  resume?: ResumeStudioView;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  setAccount: (account: AccountSnapshot) => void;
  setSnapshot: (snapshot: CandidateSnapshot) => void;
}

// One hook, one refresh: the three readings share a single loading state.
// eslint-disable-next-line max-lines-per-function
export function useCareerCabinetData(candidateId: string): CareerCabinetData {
  const [state, setState] = useState(() => initialCabinetState(candidateId));

  const refresh = useCallback(async () => {
    const cached = cabinetCache(candidateId);
    setState((current) => {
      const base = current.candidateId === candidateId ? current : stateFromCache(candidateId, cached);
      return { ...base, loading: !hasProfile(base), error: undefined };
    });
    try {
      const [nextAccount, nextSnapshot, nextResume] = await Promise.all([
        getAccount(),
        getCandidate(),
        // The resume is a secondary reading: a failure here must not blank the
        // cabinet, so it degrades to "unknown" instead of throwing.
        getResumeStudio().catch(() => undefined),
      ]);
      if (!nextAccount || typeof nextAccount !== 'object' || !nextAccount.profile) {
        throw new CoachApiError(
          'Не удалось загрузить данные аккаунта. Повторите запрос.',
          'malformed_account',
          true,
        );
      }
      if (
        !nextSnapshot ||
        typeof nextSnapshot !== 'object' ||
        !Array.isArray(nextSnapshot.memory) ||
        !nextSnapshot.candidate
      ) {
        throw new CoachApiError(
          'Не удалось загрузить профиль кандидата. Повторите запрос.',
          'malformed_snapshot',
          true,
        );
      }
      setState({
        candidateId,
        account: nextAccount,
        snapshot: nextSnapshot,
        resume: nextResume,
        loading: false,
      });
    } catch (reason) {
      setState((current) => {
        const base =
          current.candidateId === candidateId ? current : stateFromCache(candidateId, cached);
        return { ...base, loading: false, error: cabinetError(reason) };
      });
    }
  }, [candidateId]);

  useEffect(() => {
    setState(initialCabinetState(candidateId));
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (state.candidateId !== candidateId || !state.account || !state.snapshot) return;
    const storage = cabinetStorage();
    if (storage) {
      writeCareerCabinetCache(storage, candidateId, {
        account: state.account,
        snapshot: state.snapshot,
        resume: state.resume,
      });
    }
  }, [candidateId, state]);

  const setAccount = useCallback(
    (nextAccount: AccountSnapshot) => {
      setState((current) => ({
        ...stateForCandidate(current, candidateId),
        account: nextAccount,
      }));
    },
    [candidateId],
  );
  const setSnapshot = useCallback(
    (nextSnapshot: CandidateSnapshot) => {
      setState((current) => ({
        ...stateForCandidate(current, candidateId),
        snapshot: nextSnapshot,
      }));
    },
    [candidateId],
  );

  const visibleState = stateForCandidate(state, candidateId);

  return {
    account: visibleState.account,
    snapshot: visibleState.snapshot,
    resume: visibleState.resume,
    loading: visibleState.loading,
    error: visibleState.error,
    refresh,
    setAccount,
    setSnapshot,
  };
}

interface CareerCabinetState {
  candidateId: string;
  account?: AccountSnapshot;
  snapshot?: CandidateSnapshot;
  resume?: ResumeStudioView;
  loading: boolean;
  error?: string;
}

function initialCabinetState(candidateId: string): CareerCabinetState {
  return stateFromCache(candidateId, cabinetCache(candidateId));
}

function stateFromCache(
  candidateId: string,
  cached = cabinetCache(candidateId),
): CareerCabinetState {
  return {
    candidateId,
    account: cached?.account,
    snapshot: cached?.snapshot,
    resume: cached?.resume,
    loading: !cached,
  };
}

function stateForCandidate(
  current: CareerCabinetState,
  candidateId: string,
): CareerCabinetState {
  return current.candidateId === candidateId ? current : initialCabinetState(candidateId);
}

function hasProfile(state: CareerCabinetState): boolean {
  return Boolean(state.account && state.snapshot);
}

function cabinetCache(candidateId: string) {
  const storage = cabinetStorage();
  return storage ? readCareerCabinetCache(storage, candidateId) : undefined;
}

function cabinetStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function cabinetError(reason: unknown): string {
  return apiErrorMessage(
    reason,
    'Не удалось загрузить карьерный кабинет. Повторите запрос.',
  );
}
