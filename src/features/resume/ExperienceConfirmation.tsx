import { useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import { CoachApiError, type CandidateMemory } from '../coach/coachApi';
import { confirmProfileExperience } from './profileHistoryApi';
import type { ResumeExperienceInput } from './resumeTypes';

export interface ExperienceConfirmation {
  readonly confirmed: boolean;
  /** Latest date the candidate confirmed a fact of this place by accepting a consultant edit. */
  readonly consultantAt?: string;
}

/** Every bullet of the place is confirmed by the candidate (owner, 01.11: «Принять» counts). */
export function experienceConfirmation(
  entry: ResumeExperienceInput,
  memory: readonly CandidateMemory[],
): ExperienceConfirmation {
  const linked = entry.bulletMemoryIds.flatMap((id) => memory.filter((fact) => fact.id === id));
  const confirmed =
    linked.length > 0 &&
    linked.length === entry.bulletMemoryIds.length &&
    linked.every(
      (fact) => fact.status === 'confirmed' && fact.confidence === 'candidate-confirmed',
    );
  const ids = new Set([entry.chronologyMemoryId, ...entry.bulletMemoryIds]);
  const consultantAt = memory
    .filter((fact) => ids.has(fact.id) && fact.consultantConfirmedAt)
    .map((fact) => fact.consultantConfirmedAt!)
    .sort()
    .at(-1);
  return consultantAt ? { confirmed, consultantAt } : { confirmed };
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

/** «Подтверждено вами · с консультантом 01.11». */
export function experienceConfirmationLabel({
  confirmed,
  consultantAt,
}: ExperienceConfirmation): string {
  if (!confirmed) return 'Не подтверждено вами';
  return consultantAt
    ? `Подтверждено вами · с консультантом ${shortDate(consultantAt)}`
    : 'Подтверждено вами';
}

/** The explicit «Подтвердить» for a place nobody proposed edits to. */
export function ConfirmExperienceButton({
  experienceId,
  onConfirmed,
  className = 'career-quiet-button career-btn-sm',
}: {
  readonly experienceId: string;
  readonly onConfirmed?: () => Promise<void> | void;
  readonly className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmProfileExperience(experienceId);
      await onConfirmed?.();
    } catch (caught) {
      setError(caught instanceof CoachApiError ? caught.message : 'Не удалось подтвердить.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        data-testid="confirm-experience"
        onClick={() => void confirm()}
      >
        <CheckCircle size={16} aria-hidden="true" />
        <span>{busy ? 'Подтверждаю…' : 'Подтвердить'}</span>
      </button>
      {error ? (
        <span className="career-profile-screen-confirm-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
