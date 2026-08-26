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
  const [account, setAccount] = useState<AccountSnapshot>();
  const [snapshot, setSnapshot] = useState<CandidateSnapshot>();
  const [resume, setResume] = useState<ResumeStudioView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setError(undefined);
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
      setAccount(nextAccount);
      setSnapshot(nextSnapshot);
      setResume(nextResume);
    } catch (reason) {
      setError(cabinetError(reason));
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return {
    account,
    snapshot,
    resume,
    loading,
    error,
    refresh,
    setAccount,
    setSnapshot,
  };
}

function cabinetError(reason: unknown): string {
  return apiErrorMessage(
    reason,
    'Не удалось загрузить карьерный кабинет. Повторите запрос.',
  );
}
