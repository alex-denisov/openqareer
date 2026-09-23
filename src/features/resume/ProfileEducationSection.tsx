import { useState } from 'react';
import { addEducation, removeEducation, updateEducation } from './resumeStudioModel';
import {
  SectionAddButton,
  SectionEditActions,
  SectionPencilButton,
  SectionRemoveButton,
} from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { ResumeDraft, ResumeEducationInput } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
}

// eslint-disable-next-line max-lines-per-function
function EducationEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeEducationInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeEducationInput>) => void;
}) {
  const [institution, setInstitution] = useState(entry.institution ?? '');
  const [qualification, setQualification] = useState(entry.qualification ?? '');
  const [startDate, setStartDate] = useState(entry.startDate ?? '');
  const [endDate, setEndDate] = useState(entry.endDate ?? '');
  const [description, setDescription] = useState(entry.description ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Учебное заведение</span>
          <input value={institution} onChange={(event) => setInstitution(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Квалификация</span>
          <input value={qualification} onChange={(event) => setQualification(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Начало</span>
          <input value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Окончание</span>
          <input value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
      </div>
      <label className="career-profile-screen-field">
        <span>Описание</span>
        <textarea
          className="career-profile-screen-textarea"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSave({ institution, qualification, startDate, endDate, description })}
      />
    </div>
  );
}

function EducationRow({
  entry,
  saving,
  onSave,
  onRemove,
}: {
  readonly entry: ResumeEducationInput;
  readonly saving?: boolean;
  readonly onSave: (patch: Partial<ResumeEducationInput>) => void;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <EducationEditForm
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
    <div className="career-profile-screen-edu-item">
      <div className="career-profile-screen-position-title-row">
        <b>{entry.institution || 'Учебное заведение не указано'}</b>
        <SectionPencilButton label="Изменить образование" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить образование" onClick={onRemove} />
      </div>
      <div className="career-profile-screen-edu-meta">
        {[entry.qualification, [entry.startDate, entry.endDate].filter(Boolean).join(' — ')]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {entry.description ? <p>{entry.description}</p> : null}
    </div>
  );
}

export function ProfileEducationSection({ draft, saving, onSectionSave }: SectionProps) {
  const addItem = () => onSectionSave(addEducation(draft, `manual-${Date.now()}`));
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-education"
      aria-labelledby="sec-education-title"
    >
      <SectionHead
        id="sec-education-title"
        title="Образование"
        count={draft.education.length ? String(draft.education.length) : undefined}
        imported={draft.education.length > 0}
        action={<SectionAddButton label="Добавить образование" onClick={addItem} />}
      />
      {!draft.education.length ? (
        <p className="career-profile-screen-empty-note">Образование ещё не добавлено.</p>
      ) : (
        draft.education.map((entry) => (
          <EducationRow
            key={entry.id}
            entry={entry}
            saving={saving}
            onSave={(patch) => onSectionSave(updateEducation(draft, entry.id, patch))}
            onRemove={() => onSectionSave(removeEducation(draft, entry.id))}
          />
        ))
      )}
    </section>
  );
}
