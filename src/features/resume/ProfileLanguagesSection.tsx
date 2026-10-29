import { useState } from 'react';
import { useProfileEntrySave, type ProfileEntrySaveResult } from './profileEntrySave';
import { addLanguage, removeLanguage, updateLanguage } from './resumeStudioModel';
import {
  SectionAddButton,
  SectionEditActions,
  SectionPencilButton,
  SectionRemoveButton,
} from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import { ProfileFactProvenance } from './ProfileProvenanceChip';
import type { CefrLevel, ResumeDraft, ResumeLanguageInput } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => ProfileEntrySaveResult;
}

const CEFR_LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const CEFR_LABELS: Record<CefrLevel, string> = {
  A1: 'начальный',
  A2: 'базовый',
  B1: 'средний',
  B2: 'выше среднего',
  C1: 'свободный',
  C2: 'в совершенстве',
};
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  english: 'Английский',
  russian: 'Русский',
  german: 'Немецкий',
  french: 'Французский',
  spanish: 'Испанский',
  chinese: 'Китайский',
  italian: 'Итальянский',
};

export function languageName(name: string): string {
  return LANGUAGE_NAMES[name.trim().toLocaleLowerCase('en')] ?? name;
}

const NATIVE_SOURCE = /native|bilingual|родн/iu;

/** Native or bilingual is the full scale, whatever CEFR letter the source attached. */
function isNativeLanguage(entry: ResumeLanguageInput): boolean {
  return NATIVE_SOURCE.test(entry.sourceLabel ?? '');
}

function LanguageMeter({
  name,
  level,
  native = false,
}: {
  readonly name: string;
  readonly level: CefrLevel;
  readonly native?: boolean;
}) {
  const activeCount = native ? CEFR_LEVELS.length : CEFR_LEVELS.indexOf(level) + 1;
  return (
    <span
      className="career-profile-screen-lang-meter"
      role="img"
      aria-label={native ? 'Уровень: родной' : `Уровень ${level}: ${CEFR_LABELS[level]}`}
    >
      {Array.from({ length: CEFR_LEVELS.length }, (_, index) => (
        <span
          key={`${name}-${index}`}
          className={index < activeCount ? 'is-active' : ''}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

export function LanguageEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeLanguageInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeLanguageInput>) => ProfileEntrySaveResult;
}) {
  const submit = useProfileEntrySave(onSave, (patch: Partial<ResumeLanguageInput>) =>
    patch.name?.trim() ? undefined : 'Укажите язык.',
  );
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
      {submit.error ? (
        <p className="career-resume-error" role="alert">
          {submit.error}
        </p>
      ) : null}
      <SectionEditActions
        saving={saving || submit.busy}
        onCancel={onCancel}
        onSave={() => {
          void submit.save({ name, cefr: cefr || undefined });
        }}
      />
    </div>
  );
}

function LanguageLevel({ entry }: { readonly entry: ResumeLanguageInput }) {
  const native = isNativeLanguage(entry);
  return (
    <span className="career-profile-screen-lang-level">
      {native
        ? 'родной'
        : entry.cefr
          ? `${CEFR_LABELS[entry.cefr]} (${entry.cefr})`
          : 'Уровень не указан'}
      {entry.cefr || native ? (
        <LanguageMeter name={entry.name ?? ''} level={entry.cefr ?? 'C2'} native={native} />
      ) : null}
    </span>
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
  readonly onSave: (patch: Partial<ResumeLanguageInput>) => ProfileEntrySaveResult;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <LanguageEditForm
        entry={entry}
        saving={saving}
        onCancel={() => setEditing(false)}
        onSave={async (patch) => {
          const result = await onSave(patch);
          if (result !== false) setEditing(false);
          return result;
        }}
      />
    );
  }
  return (
    <div className="career-profile-screen-lang-item">
      <div className="career-profile-screen-lang-row">
        <div className="career-profile-screen-lang-name">
          {languageName(entry.name || 'Язык не указан')}
        </div>
        <LanguageLevel entry={entry} />
        <SectionPencilButton label="Изменить язык" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить язык" onClick={onRemove} />
      </div>
      <p className="career-profile-screen-lang-source">
        <ProfileFactProvenance memoryId={entry.evidenceMemoryId} />
      </p>
    </div>
  );
}

export function ProfileLanguagesSection({ draft, saving, onSectionSave }: SectionProps) {
  const [newEntry, setNewEntry] = useState<ResumeLanguageInput>();
  const addItem = () =>
    setNewEntry(addLanguage(draft, `manual-${crypto.randomUUID()}`).languages.at(-1));
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
        action={<SectionAddButton label="Добавить язык" onClick={addItem} />}
      />
      {newEntry ? (
        <LanguageEditForm
          entry={newEntry}
          saving={saving}
          onCancel={() => setNewEntry(undefined)}
          onSave={async (patch) => {
            const result = await onSectionSave({
              ...draft,
              languages: [...draft.languages, { ...newEntry, ...patch }],
            });
            if (result !== false) setNewEntry(undefined);
            return result;
          }}
        />
      ) : null}
      {!draft.languages.length ? (
        <p className="career-profile-screen-empty-note">Языки ещё не добавлены.</p>
      ) : (
        <div className="career-profile-language-grid">
          {draft.languages.map((entry) => (
            <LanguageRow
              key={entry.id}
              entry={entry}
              saving={saving}
              onSave={(patch) => onSectionSave(updateLanguage(draft, entry.id, patch))}
              onRemove={() => onSectionSave(removeLanguage(draft, entry.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}
