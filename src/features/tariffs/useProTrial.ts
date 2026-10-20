import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  getCandidateBillingSummary,
  type CandidateBillingSummary,
} from '../shell/candidateBillingApi';
import { activateProTrial, getProTrial, type CandidateProTrial } from './proTrialApi';

type OnSummaryChanged = ((summary: CandidateBillingSummary) => void) | undefined;
type TrialSetter = Dispatch<SetStateAction<CandidateProTrial | null>>;
type ErrorSetter = Dispatch<SetStateAction<string | null>>;

export function useProTrial(onSummaryChanged: OnSummaryChanged) {
  const [trial, setTrial] = useState<CandidateProTrial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    try {
      setTrial(await getProTrial());
    } catch {
      setError('Не удалось проверить пробный период. Повторите проверку.');
    }
  }, []);
  useEffect(() => {
    let active = true;
    getProTrial()
      .then((next) => {
        if (active) setTrial(next);
      })
      .catch(() => {
        if (active) setError('Не удалось проверить пробный период. Повторите проверку.');
      });
    return () => {
      active = false;
    };
  }, []);
  useTrialExpiry(trial, refresh, setError, onSummaryChanged);
  const activation = useTrialActivation(setTrial, setError, onSummaryChanged);
  return { trial, error, refresh, ...activation };
}

function useTrialExpiry(
  trial: CandidateProTrial | null,
  refresh: () => Promise<void>,
  setError: ErrorSetter,
  onSummaryChanged: OnSummaryChanged,
) {
  const deadline = useMemo(
    () =>
      trial?.status === 'active' && trial.expiresAt
        ? performance.now() + Math.max(0, Date.parse(trial.expiresAt) - Date.parse(trial.serverNow))
        : null,
    [trial],
  );
  useEffect(() => {
    if (deadline === null) return;
    // Re-renders must not postpone the server's expiry deadline.
    const delay = Math.max(0, deadline - performance.now());
    const timer = window.setTimeout(() => {
      void refresh()
        .then(() => getCandidateBillingSummary())
        .then((summary) => onSummaryChanged?.(summary))
        .catch(() => setError('Обновите тариф, чтобы проверить доступ после пробного периода.'));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [deadline, refresh, setError, onSummaryChanged]);
}

function useTrialActivation(
  setTrial: TrialSetter,
  setError: ErrorSetter,
  onSummaryChanged: OnSummaryChanged,
) {
  const [busy, setBusy] = useState(false);
  async function activate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setTrial(await activateProTrial());
      onSummaryChanged?.(await getCandidateBillingSummary());
    } catch {
      try {
        setTrial(await getProTrial());
      } catch {
        /* Keep the last confirmed server state. */
      }
      setError('Не удалось обновить пробный Pro. Проверьте состояние и попробуйте снова.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, activate };
}
