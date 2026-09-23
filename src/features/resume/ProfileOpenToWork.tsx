import { useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { openToWorkDismissalKey } from './profileEditing';
import type { ResumeDraft } from './resumeTypes';

const WORKPLACE_LABELS: Record<string, string> = {
  on_site: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

function readDismissed(key: string | undefined): boolean {
  if (!key || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * A proposal read from a native source, never written to work preferences
 * until the candidate confirms it (B265 §3c, server/domain/resumeDraft.ts
 * `ResumeSourceSuggestionsInput`). Declining it is remembered until the next
 * import produces a different proposal, not forever and not silently reset
 * on every page load.
 */
// eslint-disable-next-line max-lines-per-function
export function ProfileOpenToWork({
  candidateId,
  draft,
  onConfirm,
  confirming,
}: {
  readonly candidateId: string;
  readonly draft: ResumeDraft;
  readonly onConfirm: (workMode: 'office' | 'hybrid' | 'remote' | 'flexible') => void;
  readonly confirming?: boolean;
}) {
  const openToWork = draft.sourceSuggestions?.openToWork;
  const dismissKey = openToWorkDismissalKey(candidateId, draft.sourceSuggestions);
  const [dismissed, setDismissed] = useState(() => readDismissed(dismissKey));
  if (!openToWork || dismissed) return null;

  const workModes = openToWork.workplaceTypes.map((mode) => WORKPLACE_LABELS[mode] ?? mode);
  const primaryMode = openToWork.workplaceTypes.includes('remote')
    ? 'remote'
    : openToWork.workplaceTypes.includes('hybrid')
      ? 'hybrid'
      : 'office';

  function dismiss() {
    setDismissed(true);
    if (dismissKey && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(dismissKey, '1');
      } catch {
        // Best effort: worst case the banner reappears next visit.
      }
    }
  }

  return (
    <div className="career-profile-otw" role="region" aria-label="Open to work">
      <div className="career-profile-otw-head">
        <Sparkle size={16} weight="fill" />
        <h2>LinkedIn: «Open to work» — только для рекрутеров</h2>
        <span className="career-cabinet-tag is-warning">Предложено · требует решения</span>
      </div>
      <p className="career-profile-otw-body">
        В LinkedIn открыта видимость поиска работы. OpenQareer ничего не меняет
        в целях поиска, пока вы не подтвердите.
      </p>
      <div className="career-profile-otw-facts">
        {workModes.length ? (
          <span className="career-cabinet-tag">Формат: {workModes.join(' · ')}</span>
        ) : null}
        {openToWork.roles.length ? (
          <span className="career-cabinet-tag">Роли: {openToWork.roles.join(', ')}</span>
        ) : null}
        {openToWork.locations.length ? (
          <span className="career-cabinet-tag">Регионы: {openToWork.locations.join(', ')}</span>
        ) : null}
      </div>
      <div className="career-profile-otw-actions">
        <button
          type="button"
          className="career-primary-button"
          disabled={confirming}
          onClick={() => onConfirm(primaryMode)}
        >
          {confirming ? 'Применяем…' : 'Подтвердить и применить к целям поиска'}
        </button>
        <button type="button" className="career-quiet-button" onClick={dismiss}>
          Отклонить
        </button>
      </div>
    </div>
  );
}
