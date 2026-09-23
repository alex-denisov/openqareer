import { useState } from 'react';
import { addLanguage, removeLanguage, updateLanguage } from './resumeStudioModel';
import {
  SectionAddButton,
  SectionEditActions,
  SectionPencilButton,
  SectionRemoveButton,
} from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { CefrLevel, ResumeDraft, ResumeLanguageInput } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
}

const CEFR_LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function LanguageEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeLanguageInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeLanguageInput>) => void;
}) {
  const [name, setName] = useState(entry.name ?? '');
  const [cefr, setCefr] = useState<CefrLevel | ''>(entry.cefr ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Язык</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Уровень (CEFR)</span>
          <select value={cefr} onChange={(event) => setCefr(event.target.value as CefrLevel)}>
            <option value="">—</option>
            {CEFR_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSave({ name, cefr: cefr || undefined })}
      />
    </div>
  );
}

function LanguageRow({
  entry,
  saving,
  onSave,
  onRemove,
}: {
  readonly entry: ResumeLanguageInput;
  readonly saving?: boolean;
  readonly onSave: (patch: Partial<ResumeLanguageInput>) => void;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <LanguageEditForm
        entry={entry}
        saving={saving}
        onCancel={() => setEditing(false)}
        onSave={(patch) => {
          onSave(patch);
          setEditing(false);
        }}
      />
    );
  }
  return (
    <div className="career-profile-screen-lang-item">
      <div className="career-profile-screen-lang-row">
        <div className="career-profile-screen-lang-name">{entry.name || 'Язык не указан'}</div>
        {entry.cefr ? <span className="career-profile-screen-cefr">{entry.cefr}</span> : null}
        <SectionPencilButton label="Изменить язык" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить язык" onClick={onRemove} />
      </div>
      {entry.sourceLabel && entry.cefr ? (
        <p className="career-profile-screen-lang-source">
          LinkedIn: «{entry.sourceLabel}» → {entry.cefr}
        </p>
      ) : null}
    </div>
  );
}

export function ProfileLanguagesSection({ draft, saving, onSectionSave }: SectionProps) {
  const addItem = () => onSectionSave(addLanguage(draft, `manual-${Date.now()}`));
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-languages"
      aria-labelledby="sec-languages-title"
    >
      <SectionHead
        id="sec-languages-title"
        title="Языки"
        count={draft.languages.length ? String(draft.languages.length) : undefined}
        imported={draft.languages.length > 0}
        action={<SectionAddButton label="Добавить язык" onClick={addItem} />}
      />
      {!draft.languages.length ? (
        <p className="career-profile-screen-empty-note">Языки ещё не добавлены.</p>
      ) : (
        draft.languages.map((entry) => (
          <LanguageRow
            key={entry.id}
            entry={entry}
            saving={saving}
            onSave={(patch) => onSectionSave(updateLanguage(draft, entry.id, patch))}
            onRemove={() => onSectionSave(removeLanguage(draft, entry.id))}
          />
        ))
      )}
    </section>
  );
}
