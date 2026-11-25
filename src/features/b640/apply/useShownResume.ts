import { useCallback, useMemo, useState } from 'react';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import {
  attachLetterResume,
  prepareVacancyLetterResume,
  type ApprovedVacancyLetterResult,
} from '../../vacancies/vacancyLetterApi';
import { useAsync } from '../responses/data/useAsync';
import { readAtsAttempt } from './ats/atsDesktop';

type Approved = ApprovedVacancyLetterResult;
type Resume = Approved['resume'];

/** Свежая версия уже одобренного отклика; нажатие на сайте уже было или собрать не вышло — `null`. */
export async function freshVersion(vacancyId: string, resume: Resume): Promise<string | null> {
  if (resume?.kind !== 'targeted' || !resume.versionId) return null;
  try {
    const attempt = isTauriEnvironment() ? await readAtsAttempt(vacancyId) : null;
    if (attempt && attempt.result !== 'failed') return null;
    const prepared = await prepareVacancyLetterResume(vacancyId);
    return prepared.replaceable ? (prepared.versionId ?? null) : null;
  } catch {
    // Уйдёт ровно то резюме, которое одобрено.
    return null;
  }
}

export interface ShownResume {
  /** Резюме, которое приложено и уйдёт. */
  readonly attached: Resume;
  /** Резюме на шаге «Резюме»: приложенное или собранное заново и ещё не одобренное. */
  readonly shown: Resume;
  readonly gate: 'open' | 'checking' | 'changed';
  /** Одобрить показанную версию. */
  readonly approve: (versionId: string | null) => Promise<void>;
}

/** Кандидат одобряет ту версию, которую видит; уходит только она (B785). */
export function useShownResume(vacancyId: string, approved: Approved | null): ShownResume {
  const [replaced, setReplaced] = useState<{ readonly of: string; readonly resume: Resume } | null>(
    null,
  );
  const [seen, setSeen] = useState<string | null>(null);
  const attached =
    approved && replaced?.of === approved.documentId ? replaced.resume : (approved?.resume ?? null);
  const key = attached?.kind === 'targeted' ? `${vacancyId}:${attached.versionId ?? ''}` : '';
  const load = useCallback(
    async () => ({ key, fresh: key ? await freshVersion(vacancyId, attached) : null }),
    // `key` меняется вместе с приложенной версией.
    [vacancyId, key],
  );
  const { state } = useAsync(load, '');
  const checking = key !== '' && state.data?.key !== key;
  const fresh = checking ? null : (state.data?.fresh ?? null);
  const shown = useMemo(
    () => (attached && fresh ? { ...attached, versionId: fresh } : attached),
    [attached, fresh],
  );
  const changed =
    key !== '' &&
    Boolean(shown?.versionId) &&
    (shown?.versionId !== attached?.versionId || (seen !== null && seen !== shown?.versionId));
  const approve = async (versionId: string | null) => {
    if (approved && versionId && versionId !== attached?.versionId) {
      const resume = await attachLetterResume(vacancyId, versionId);
      setReplaced({ of: approved.documentId, resume });
    }
    setSeen(versionId);
  };
  return { attached, shown, gate: checking ? 'checking' : changed ? 'changed' : 'open', approve };
}
