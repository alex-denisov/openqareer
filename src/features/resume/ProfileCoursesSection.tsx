import { useState } from 'react';
import { useProfileEntrySave, type ProfileEntrySaveResult } from './profileEntrySave';
import { BookOpen } from '@phosphor-icons/react';
import { updateCourse } from './profileEntryEditing';
import { addCourse, removeCourse } from './resumeStudioModel';
import {
  SectionAddButton,
  SectionEditActions,
  SectionPencilButton,
  SectionRemoveButton,
} from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { ResumeCourseInput, ResumeDraft } from './resumeTypes';

interface SectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => ProfileEntrySaveResult;
  readonly importedLabel?: string;
}

export function CourseEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeCourseInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeCourseInput>) => ProfileEntrySaveResult;
}) {
  const submit = useProfileEntrySave(onSave, (patch: Partial<ResumeCourseInput>) =>
    patch.name?.trim() ? undefined : 'Укажите название курса.',
  );
  const [name, setName] = useState(entry.name);
  const [institution, setInstitution] = useState(entry.institution ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Название</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Организация</span>
          <input value={institution} onChange={(event) => setInstitution(event.target.value)} />
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
          void submit.save({ name, institution });
        }}
      />
    </div>
  );
}

function CourseTile({
  entry,
  saving,
  onSave,
  onRemove,
}: {
  readonly entry: ResumeCourseInput;
  readonly saving?: boolean;
  readonly onSave: (patch: Partial<ResumeCourseInput>) => ProfileEntrySaveResult;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <CourseEditForm
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
    <div className="career-profile-screen-tile">
      <div className="career-profile-screen-tile-head">
        <b>{entry.name}</b>
        <SectionPencilButton label="Изменить курс" onClick={() => setEditing(true)} />
        <SectionRemoveButton label="Удалить курс" onClick={onRemove} />
      </div>
      <span className="career-profile-screen-tile-meta">
        {[entry.institution ?? entry.provider, entry.year ? String(entry.year) : undefined]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  );
}

/**
 * Courses stay honest about a source that never had them (B265 §4: "честное
 * «пусто в источнике»") — the section still renders, saying so plainly, and
 * still offers a working add action instead of vanishing.
 */
function NewCourseEntryForm({
  draft,
  entry,
  saving,
  onSectionSave,
  onCancel,
}: SectionProps & { readonly entry: ResumeCourseInput; readonly onCancel: () => void }) {
  return (
    <CourseEditForm
      entry={entry}
      saving={saving}
      onCancel={onCancel}
      onSave={async (patch) => {
        const result = await onSectionSave({
          ...draft,
          courses: [...(draft.courses ?? []), { ...entry, ...patch }],
        });
        if (result !== false) onCancel();
        return result;
      }}
    />
  );
}

function EmptyCourses({ importedLabel }: Pick<SectionProps, 'importedLabel'>) {
  return (
    <div className="career-profile-screen-state-block">
      <BookOpen size={22} />
      <h3>{importedLabel ? 'В импортированных данных курсы не найдены' : 'Курсы не заполнены'}</h3>
      <p>Если курсы у вас есть, добавьте их вручную.</p>
    </div>
  );
}

export function ProfileCoursesSection({
  draft,
  saving,
  onSectionSave,
  importedLabel,
}: SectionProps) {
  const courses = draft.courses ?? [];
  const [newEntry, setNewEntry] = useState<ResumeCourseInput>();
  const addItem = () => setNewEntry(addCourse(draft, '').courses?.at(-1));
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-courses"
      aria-labelledby="sec-courses-title"
    >
      <SectionHead
        id="sec-courses-title"
        title="Курсы"
        emptyTag={!courses.length}
        action={<SectionAddButton label="Добавить курс" onClick={addItem} />}
      />
      {newEntry ? (
        <NewCourseEntryForm
          draft={draft}
          entry={newEntry}
          saving={saving}
          onSectionSave={onSectionSave}
          onCancel={() => setNewEntry(undefined)}
        />
      ) : null}
      {!courses.length ? (
        <EmptyCourses importedLabel={importedLabel} />
      ) : (
        <div className="career-profile-screen-tile-grid">
          {courses.map((course) => (
            <CourseTile
              key={course.id}
              entry={course}
              saving={saving}
              onSave={(patch) => onSectionSave(updateCourse(draft, course.id, patch))}
              onRemove={() => onSectionSave(removeCourse(draft, course.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}
