import { useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { CANDIDATE_REGION_CATALOGUE, type CandidateRegion } from '../workspace/candidateRegions';
import { mapOpenToWorkLocations } from './openToWorkRegions';
import { openToWorkDismissalKey } from './profileEditing';
import type { ResumeDraft } from './resumeTypes';

type WorkMode = 'office' | 'hybrid' | 'remote' | 'flexible';

const WORKPLACE_LABELS: Record<string, string> = {
  on_site: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

const WORK_MODE_OPTIONS: readonly { value: WorkMode; label: string }[] = [
  { value: 'office', label: 'Только офис' },
  { value: 'hybrid', label: 'Только гибрид' },
  { value: 'remote', label: 'Только удалённо' },
  { value: 'flexible', label: 'On-site · Hybrid · Remote' },
];

function readDismissed(key: string | undefined): boolean {
  if (!key || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function primaryWorkMode(workplaceTypes: readonly string[]): WorkMode {
  if (workplaceTypes.includes('remote')) return 'remote';
  if (workplaceTypes.includes('hybrid')) return 'hybrid';
  if (workplaceTypes.includes('on_site')) return 'office';
  return 'flexible';
}

export interface OpenToWorkConfirmation {
  readonly workMode: WorkMode;
  readonly regions: readonly CandidateRegion[];
}

function toggleRegion(
  regions: readonly CandidateRegion[],
  region: CandidateRegion,
): readonly CandidateRegion[] {
  return regions.includes(region)
    ? regions.filter((entry) => entry !== region)
    : [...regions, region];
}

function OpenToWorkFields({
  mode,
  regions,
  unmatchedLocations,
  onMode,
  onRegions,
}: {
  readonly mode: WorkMode;
  readonly regions: readonly CandidateRegion[];
  readonly unmatchedLocations: readonly string[];
  readonly onMode: (mode: WorkMode) => void;
  readonly onRegions: (regions: readonly CandidateRegion[]) => void;
}) {
  return (
    <div className="career-profile-screen-field-grid">
      <label className="career-profile-screen-field">
        <span>Формат работы</span>
        <select value={mode} onChange={(event) => onMode(event.target.value as WorkMode)}>
          {WORK_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="career-profile-screen-field">
        <span>Регионы</span>
        <div className="career-profile-screen-region-picker" role="group" aria-label="Регионы">
          {CANDIDATE_REGION_CATALOGUE.map((region) => (
            <label key={region.id} className="career-profile-screen-region-option">
              <input
                type="checkbox"
                checked={regions.includes(region.id)}
                onChange={() => onRegions(toggleRegion(regions, region.id))}
              />
              {region.label}
            </label>
          ))}
        </div>
        {unmatchedLocations.length > 0 ? (
          <p className="career-profile-screen-region-unmatched">
            LinkedIn также назвал {unmatchedLocations.join(', ')} — это не совпало ни с одним
            регионом каталога, выберите его вручную выше.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "Изменить перед подтверждением": the candidate can correct the work mode
 * and the region list LinkedIn proposed before anything is applied — the
 * mockup's middle action, distinct from a blind "Подтвердить" (B265 review).
 */
function OpenToWorkEditForm({
  workMode,
  regions,
  unmatchedLocations,
  confirming,
  onCancel,
  onSave,
}: {
  readonly workMode: WorkMode;
  readonly regions: readonly CandidateRegion[];
  readonly unmatchedLocations: readonly string[];
  readonly confirming?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (confirmation: OpenToWorkConfirmation) => void;
}) {
  const [mode, setMode] = useState<WorkMode>(workMode);
  const [selectedRegions, setSelectedRegions] = useState<readonly CandidateRegion[]>(regions);
  return (
    <div className="career-profile-screen-edit-body">
      <OpenToWorkFields
        mode={mode}
        regions={selectedRegions}
        unmatchedLocations={unmatchedLocations}
        onMode={setMode}
        onRegions={setSelectedRegions}
      />
      <div className="career-profile-screen-edit-actions">
        <button type="button" className="career-quiet-button" onClick={onCancel}>
          Отклонить предложение
        </button>
        <button
          type="button"
          className="career-primary-button"
          disabled={confirming}
          onClick={() => onSave({ workMode: mode, regions: selectedRegions })}
        >
          {confirming ? 'Применяем…' : 'Сохранить и применить'}
        </button>
      </div>
    </div>
  );
}

interface ProfileOpenToWorkProps {
  readonly candidateId: string;
  readonly draft: ResumeDraft;
  readonly onConfirm: (confirmation: OpenToWorkConfirmation) => void;
  readonly confirming?: boolean;
}

/**
 * A proposal read from a native source, never written to work preferences
 * until the candidate confirms it (B265 §3c, server/domain/resumeDraft.ts
 * `ResumeSourceSuggestionsInput`). Three actions, matching the mockup:
 * confirm as-is, change first, or decline — declining is remembered until
 * the next import produces a different proposal, not forever.
 */
// eslint-disable-next-line max-lines-per-function
export function ProfileOpenToWork({
  candidateId,
  draft,
  onConfirm,
  confirming,
}: ProfileOpenToWorkProps) {
  const openToWork = draft.sourceSuggestions?.openToWork;
  const dismissKey = openToWorkDismissalKey(candidateId, draft.sourceSuggestions);
  const [dismissed, setDismissed] = useState(() => readDismissed(dismissKey));
  const [editing, setEditing] = useState(false);
  if (!openToWork || dismissed) return null;

  const workModes = openToWork.workplaceTypes.map((mode) => WORKPLACE_LABELS[mode] ?? mode);
  const primaryMode = primaryWorkMode(openToWork.workplaceTypes);
  const { matched: matchedRegions, unmatched: unmatchedLocations } = mapOpenToWorkLocations(
    openToWork.locations,
  );

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
    <div className="career-profile-screen-otw" role="region" aria-label="Open to work">
      <div className="career-profile-screen-otw-head">
        <Sparkle size={16} weight="fill" />
        <h2>LinkedIn: «Open to work» — только для рекрутеров</h2>
        <span className="career-profile-screen-tag is-warning">Предложено · требует решения</span>
      </div>
      <p className="career-profile-screen-otw-body">
        В LinkedIn открыта видимость поиска работы. OpenQareer ничего не меняет в целях поиска, пока
        вы не подтвердите.
      </p>
      <div className="career-profile-screen-otw-facts">
        {workModes.length ? (
          <span className="career-profile-screen-tag">Формат: {workModes.join(' · ')}</span>
        ) : null}
        {openToWork.roles.length ? (
          <span className="career-profile-screen-tag">Роли: {openToWork.roles.join(', ')}</span>
        ) : null}
        {openToWork.locations.length ? (
          <span className="career-profile-screen-tag">
            Регионы: {openToWork.locations.join(', ')}
          </span>
        ) : null}
      </div>
      {editing ? (
        <OpenToWorkEditForm
          workMode={primaryMode}
          regions={matchedRegions}
          unmatchedLocations={unmatchedLocations}
          confirming={confirming}
          onCancel={() => setEditing(false)}
          onSave={(confirmation) => {
            onConfirm(confirmation);
            setEditing(false);
          }}
        />
      ) : (
        <div className="career-profile-screen-otw-actions">
          <button
            type="button"
            className="career-primary-button"
            disabled={confirming}
            onClick={() => onConfirm({ workMode: primaryMode, regions: matchedRegions })}
          >
            {confirming ? 'Применяем…' : 'Подтвердить и применить к целям поиска'}
          </button>
          <button type="button" className="career-quiet-button" onClick={() => setEditing(true)}>
            Изменить перед подтверждением
          </button>
          <button type="button" className="career-quiet-button" onClick={dismiss}>
            Отклонить
          </button>
        </div>
      )}
    </div>
  );
}
