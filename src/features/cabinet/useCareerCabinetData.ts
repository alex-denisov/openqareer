import { useCallback, useEffect, useState } from 'react';
import {
  CoachApiError,
  getAccount,
  getCandidate,
  type AccountSnapshot,
  type CandidateSnapshot,
} from '../coach/coachApi';

export interface CareerCabinetData {
  account?: AccountSnapshot;
  snapshot?: CandidateSnapshot;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  setAccount: (account: AccountSnapshot) => void;
  setSnapshot: (snapshot: CandidateSnapshot) => void;
}

export function useCareerCabinetData(candidateId: string): CareerCabinetData {
  const [account, setAccount] = useState<AccountSnapshot>();
  const [snapshot, setSnapshot] = useState<CandidateSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      const [nextAccount, nextSnapshot] = await Promise.all([getAccount(), getCandidate()]);
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
    loading,
    error,
    refresh,
    setAccount,
    setSnapshot,
  };
}

function cabinetError(reason: unknown): string {
  if (reason instanceof CoachApiError || reason instanceof Error) {
    return reason.message;
  }
  return 'Не удалось загрузить карьерный кабинет. Повторите запрос.';
}
