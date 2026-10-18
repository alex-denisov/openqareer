import { useState } from 'react';
import { Info } from '@phosphor-icons/react';
import { useProfileEntrySave, type ProfileEntrySaveResult } from './profileEntrySave';
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
  readonly onAddCourse?: () => void;
  readonly onConsultCourses?: () => void;
  readonly onSectionSave: (next: ResumeDraft) => ProfileEntrySaveResult;
}

// eslint-disable-next-line max-lines-per-function
export function EducationEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeEducationInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeEducationInput>) => ProfileEntrySaveResult;
}) {
  const submit = useProfileEntrySave(onSave, (patch: Partial<ResumeEducationInput>) =>
    patch.institution?.trim() ? undefined : 'Укажите учебное заведение.',
  );
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
      {submit.error ? (
        <p className="career-resume-error" role="alert">
          {submit.error}
        </p>
      ) : null}
      <SectionEditActions
        saving={saving || submit.busy}
        onCancel={onCancel}
        onSave={() => {
          void submit.save({ institution, qualification, startDate, endDate, description });
        }}
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
  readonly onSave: (patch: Partial<ResumeEducationInput>) => ProfileEntrySaveResult;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const years = [entry.startDate, entry.endDate].filter(Boolean).join(' — ');
  if (editing) {
    return (
      <EducationEditForm
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
    <div className="career-profile-screen-edu-item">
      <div className="career-profile-screen-position-title-row">
        <b>{entry.institution || 'Учебное заведение не указано'}</b>
        {years ? <span className="career-profile-screen-edu-years">{years}</span> : null}
        <SectionPencilButton label="Изменить образование" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить образование" onClick={onRemove} />
      </div>
      <div className="career-profile-screen-edu-meta">{entry.qualification}</div>
      {entry.description ? <p>{entry.description}</p> : null}
    </div>
  );
}

function EducationCoursesNotice({
  draft,
  onAddCourse,
  onConsultCourses,
}: Pick<SectionProps, 'draft' | 'onAddCourse' | 'onConsultCourses'>) {
  if (draft.courses?.length) return null;
  return (
    <div className="profile-education-courses-note">
      <Info size={16} aria-hidden="true" />
      <p>
        Курсы пока не добавлены.{' '}
        {onAddCourse ? (
          <button type="button" onClick={onAddCourse}>
            Добавьте вручную
          </button>
        ) : null}
        {onConsultCourses ? (
          <>
            {' '}
            или{' '}
            <button type="button" onClick={onConsultCourses}>
              расскажите консультанту
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

export function ProfileEducationSection(props: SectionProps) {
  const { draft, saving, onSectionSave } = props;
  const [newEntry, setNewEntry] = useState<ResumeEducationInput>();
  const addItem = () =>
    setNewEntry(addEducation(draft, `manual-${crypto.randomUUID()}`).education.at(-1));
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-education"
      aria-labelledby="sec-education-title"
    >
      <SectionHead
        id="sec-education-title"
        title="Образование"
        action={<SectionAddButton label="Добавить образование" onClick={addItem} />}
      />
      {newEntry ? (
        <EducationEditForm
          entry={newEntry}
          saving={saving}
          onCancel={() => setNewEntry(undefined)}
          onSave={async (patch) => {
            const result = await onSectionSave({
              ...draft,
              education: [...draft.education, { ...newEntry, ...patch }],
            });
            if (result !== false) setNewEntry(undefined);
            return result;
          }}
        />
      ) : null}
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
      <EducationCoursesNotice {...props} />
    </section>
  );
}
