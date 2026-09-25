import { useState } from 'react';
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
  readonly onSectionSave: (next: ResumeDraft) => void;
  readonly importedLabel?: string;
}

function CourseEditForm({
  entry,
  saving,
  onCancel,
  onSave,
}: {
  readonly entry: ResumeCourseInput;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<ResumeCourseInput>) => void;
}) {
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
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSave({ name, institution })}
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
  readonly onSave: (patch: Partial<ResumeCourseInput>) => void;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <CourseEditForm
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
export function ProfileCoursesSection({ draft, saving, onSectionSave, importedLabel }: SectionProps) {
  const courses = draft.courses ?? [];
  const addItem = () => onSectionSave(addCourse(draft, ''));
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
        imported={courses.length > 0}
        action={<SectionAddButton label="Добавить курс" onClick={addItem} />}
      />
      {!courses.length ? (
        <div className="career-profile-screen-state-block">
          <BookOpen size={22} />
          <h3>
            {importedLabel ? `Импорт из ${importedLabel} курсов не нашёл` : 'Курсы не заполнены'}
          </h3>
          <p>Если курсы у вас есть, добавьте их вручную.</p>
        </div>
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
