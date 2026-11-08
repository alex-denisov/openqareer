import { useCallback, useState } from 'react';
import { CoachApiError } from '../coach/apiClient';
import type { ApprovalState } from './vacancyLetterController';
import type {
  ApprovedVacancyLetterInput,
  ApprovedVacancyLetterResult,
  ConnectionCircleNumber,
  ConnectionCirclePath,
  LetterGeneralResume,
} from './vacancyLetterApi';
import { approveVacancyLetter, prepareVacancyLetterResume } from './vacancyLetterApi';
import { personAddressedByConnectionPath } from './vacancyLetterModel';
import type { ResumeSnapshotFailure } from './vacancyLetterResumeNote';
import type { VacancyPitchPayload, VacancyPitchResult } from './vacancyPitchApi';

type PitchTone = NonNullable<VacancyPitchPayload['tone']>;
type PitchLanguage = NonNullable<VacancyPitchPayload['language']>;

interface ApprovalInput {
  readonly vacancyId: string;
  readonly circle: ConnectionCircleNumber;
  readonly language: 'auto' | PitchLanguage;
  readonly tone: PitchTone;
  readonly path?: ConnectionCirclePath;
  readonly pitch: VacancyPitchResult | null;
  readonly body: string;
  readonly includedWorkplaceIds: readonly string[];
  /** Резюме в профиле изменилось после черновика: письмо готовится заново. */
  readonly onResumeChanged: () => void;
}

function approvedSnapshot(
  input: ApprovalInput & { readonly pitch: VacancyPitchResult },
  language: PitchLanguage,
  generalResumeId?: string,
): ApprovedVacancyLetterInput {
  const recipient = input.path ? personAddressedByConnectionPath(input.path) : undefined;
  return {
    circle: input.circle,
    language,
    tone: input.tone,
    ...(recipient
      ? {
          recipient: {
            id: recipient.id,
            name: recipient.fullName,
            ...(recipient.roleTitle ? { role: recipient.roleTitle } : {}),
            ...(recipient.companyName ? { company: recipient.companyName } : {}),
          },
        }
      : {}),
    ...(input.pitch.emailPitch.subject ? { subject: input.pitch.emailPitch.subject } : {}),
    body: input.body.trim(),
    usedEvidenceIds: input.pitch.usedEvidenceIds,
    includedWorkplaceIds: input.includedWorkplaceIds,
    ...(input.pitch.resumeAvailable === undefined
      ? {}
      : { resumeAvailable: input.pitch.resumeAvailable }),
    ...(generalResumeId ? { generalResumeId } : {}),
  };
}

function generalResumeOf(error: CoachApiError): LetterGeneralResume | null {
  const value = error.details.generalResume as Partial<LetterGeneralResume> | null | undefined;
  return value && typeof value.documentId === 'string' && typeof value.fileName === 'string'
    ? { documentId: value.documentId, fileName: value.fileName }
    : null;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

interface ResumeGateState {
  readonly busy: boolean;
  readonly setBusy: (busy: boolean) => void;
  readonly resumeFailure: ResumeSnapshotFailure | null;
  readonly setResumeFailure: (failure: ResumeSnapshotFailure | null) => void;
}

/** «Подготовить резюме»: повтор снимка; не удался — строка предложит общее резюме, если оно есть. */
function usePrepareResume(vacancyId: string, gate: ResumeGateState): () => Promise<void> {
  const { busy, setBusy, resumeFailure, setResumeFailure } = gate;
  return useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await prepareVacancyLetterResume(vacancyId);
      setResumeFailure(null);
    } catch (reason: unknown) {
      const generalResume =
        reason instanceof CoachApiError
          ? generalResumeOf(reason)
          : (resumeFailure?.generalResume ?? null);
      setResumeFailure({ retried: true, generalResume });
    } finally {
      setBusy(false);
    }
  }, [busy, setBusy, vacancyId, resumeFailure, setResumeFailure]);
}

/**
 * Одобрение письма (B601, решения владельца 08.11): снимок резюме не создался — письмо не одобряется,
 * строка резюме предлагает повторить снимок, а после неудачного повтора — приложить общее резюме.
 * Резюме в профиле изменилось после черновика — письмо готовится заново и одобряется ещё раз.
 */
export function useLetterApproval(input: ApprovalInput): ApprovalState {
  const [saved, setSaved] = useState<ApprovedVacancyLetterResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resumeFailure, setResumeFailure] = useState<ResumeSnapshotFailure | null>(null);
  const reset = useCallback(() => {
    setSaved(null);
    setError('');
  }, []);
  const submit = useCallback(
    async (generalResumeId?: string) => {
      if (busy || !input.pitch || !input.body.trim()) return;
      const pitch = input.pitch;
      const language = pitch.language ?? (input.language === 'auto' ? undefined : input.language);
      if (!language) {
        setError('Не удалось определить язык письма. Выберите его вручную.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const snapshot = approvedSnapshot({ ...input, pitch }, language, generalResumeId);
        setSaved(await approveVacancyLetter(input.vacancyId, snapshot));
        setResumeFailure(null);
      } catch (reason: unknown) {
        if (reason instanceof CoachApiError && reason.code === 'resume_snapshot_failed') {
          setResumeFailure((previous) => ({
            retried: previous?.retried ?? false,
            generalResume: generalResumeOf(reason),
          }));
          return;
        }
        if (reason instanceof CoachApiError && reason.code === 'letter_resume_changed') {
          input.onResumeChanged();
        }
        setError(errorMessage(reason, 'Не удалось сохранить снимок письма.'));
      } finally {
        setBusy(false);
      }
    },
    [busy, input],
  );
  // Снимок не создался: обычное одобрение закрыто, пока резюме не готово.
  const approve = useCallback(
    async () => (resumeFailure ? undefined : submit()),
    [resumeFailure, submit],
  );
  const prepareResume = usePrepareResume(input.vacancyId, {
    busy,
    setBusy,
    resumeFailure,
    setResumeFailure,
  });
  const attachGeneralResume = useCallback(async () => {
    const general = resumeFailure?.generalResume;
    if (!general) return;
    await submit(general.documentId);
  }, [resumeFailure, submit]);
  return { saved, busy, error, approve, reset, resumeFailure, prepareResume, attachGeneralResume };
}
