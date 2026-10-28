import { useRef, useState } from 'react';
import { coursesNotFoundLead, provenanceLabel } from './profileProvenance';
import { useFactProvenance, useProvenanceLabelOf } from './ProfileProvenanceChip';
import { BookOpen, Info, Plus, Student, Target, Translate } from '@phosphor-icons/react';
import { EducationEditForm } from './ProfileEducationSection';
import { ProjectEditForm } from './ProfileTileSections';
import { CourseEditForm } from './ProfileCoursesSection';
import { CEFR_LABELS, LanguageEditForm, languageName } from './ProfileLanguagesSection';
import {
  addCourse,
  addEducation,
  addLanguage,
  updateEducation,
  updateLanguage,
} from './resumeStudioModel';
import { displayMonth, displayYear } from './experienceDate';
import { addProject, updateCourse, updateProject } from './profileEntryEditing';
import { ProfileMobileGroup, ProfileMobileRow } from './ProfileMobileElements';
import type { ProfileEntrySaveResult } from './profileEntrySave';
import type { ProfileMobileDataProps } from './profileMobileTypes';
import type {
  ResumeCourseInput,
  ResumeEducationInput,
  ResumeLanguageInput,
  ResumeProjectInput,
} from './resumeTypes';

function useMobileEntryEditor<Entry extends { readonly id: string }>(
  onSave: (entry: Entry) => ProfileEntrySaveResult,
  initialEntry?: () => Entry | undefined,
) {
  const [entry, setEntry] = useState<Entry | undefined>(initialEntry);
  const generation = useRef(0);
  const edit = (next: Entry) => {
    generation.current += 1;
    setEntry(next);
  };
  const cancel = () => {
    generation.current += 1;
    setEntry(undefined);
  };
  const save = async (patch: Partial<Entry>) => {
    if (!entry) return false;
    const startedAt = generation.current;
    const result = await onSave({ ...entry, ...patch });
    if (result !== false && startedAt === generation.current) setEntry(undefined);
    return result;
  };
  return { entry, edit, cancel, save };
}

function EducationAddChoice({
  onEducation,
  onCourse,
  onCancel,
}: {
  readonly onEducation: () => void;
  readonly onCourse: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <>
      <ProfileMobileGroup title="Что добавить">
        <ProfileMobileRow icon={Student} title="Образование" onClick={onEducation} />
        <ProfileMobileRow icon={BookOpen} title="Курс" onClick={onCourse} />
      </ProfileMobileGroup>
      <button type="button" className="pm-text" onClick={onCancel}>
        Отменить
      </button>
    </>
  );
}

function useMobileEducationEditors(
  props: ProfileMobileDataProps & { readonly initialAdd?: 'education' | 'course' },
) {
  const [choosing, setChoosing] = useState(false);
  const education = useMobileEntryEditor<ResumeEducationInput>(
    (entry) =>
      props.onSectionSave(
        props.draft.education.some((item) => item.id === entry.id)
          ? updateEducation(props.draft, entry.id, entry)
          : { ...props.draft, education: [...props.draft.education, entry] },
      ),
    () =>
      props.initialAdd === 'education'
        ? addEducation(props.draft, `manual-${crypto.randomUUID()}`).education.at(-1)
        : undefined,
  );
  const course = useMobileEntryEditor<ResumeCourseInput>(
    (entry) =>
      props.onSectionSave(
        props.draft.courses?.some((item) => item.id === entry.id)
          ? updateCourse(props.draft, entry.id, entry)
          : { ...props.draft, courses: [...(props.draft.courses ?? []), entry] },
      ),
    () => (props.initialAdd === 'course' ? addCourse(props.draft, '').courses?.at(-1) : undefined),
  );
  const startEducation = () => {
    setChoosing(false);
    education.edit(addEducation(props.draft, `manual-${crypto.randomUUID()}`).education.at(-1)!);
  };
  const startCourse = () => {
    setChoosing(false);
    course.edit(addCourse(props.draft, '').courses!.at(-1)!);
  };
  return { education, course, choosing, setChoosing, startEducation, startCourse };
}

function MobileEducationRow({
  entry,
  onEdit,
}: {
  readonly entry: ResumeEducationInput;
  readonly onEdit: () => void;
}) {
  const origin = provenanceLabel(useFactProvenance(entry.evidenceMemoryId));
  return (
    <ProfileMobileRow
      icon={Student}
      title={entry.institution || 'Учебное заведение не указано'}
      detail={[
        entry.qualification,
        [displayYear(entry.startDate), displayYear(entry.endDate)].filter(Boolean).join(' — '),
        origin,
      ]
        .filter(Boolean)
        .join(' · ')}
      onClick={onEdit}
    />
  );
}

/** «2022-01» → «01.2022», as on the 1440 project tile. */
function projectPeriod(start?: string, end?: string): string {
  return [start, end]
    .map((value) => value && displayMonth(value))
    .filter(Boolean)
    .join(' — ');
}

function MobileEducationList({
  draft,
  importedSources,
  onEducation,
  onCourse,
  onAdd,
}: Pick<ProfileMobileDataProps, 'draft' | 'importedSources'> & {
  readonly onEducation: (entry: ResumeEducationInput) => void;
  readonly onCourse: (entry: ResumeCourseInput) => void;
  readonly onAdd: () => void;
}) {
  return (
    <>
      <ProfileMobileGroup>
        {draft.education.map((entry) => (
          <MobileEducationRow key={entry.id} entry={entry} onEdit={() => onEducation(entry)} />
        ))}
        {(draft.courses ?? []).map((entry) => (
          <ProfileMobileRow
            key={entry.id}
            icon={BookOpen}
            title={entry.name}
            detail={entry.institution || entry.provider}
            onClick={() => onCourse(entry)}
          />
        ))}
        <ProfileMobileRow icon={Plus} title="Добавить образование или курс" onClick={onAdd} />
      </ProfileMobileGroup>
      {!draft.courses?.length ? (
        <p className="pm-note">
          <Info size="1em" aria-hidden="true" />
          {coursesNotFoundLead(importedSources)} Добавьте вручную или расскажите консультанту.
        </p>
      ) : null}
    </>
  );
}

export function ProfileMobileEducation(
  props: ProfileMobileDataProps & { readonly initialAdd?: 'education' | 'course' },
) {
  const state = useMobileEducationEditors(props);
  if (state.education.entry)
    return (
      <EducationEditForm
        entry={state.education.entry}
        saving={props.saving}
        onSave={state.education.save}
        onCancel={state.education.cancel}
      />
    );
  if (state.course.entry)
    return (
      <CourseEditForm
        entry={state.course.entry}
        saving={props.saving}
        onSave={state.course.save}
        onCancel={state.course.cancel}
      />
    );
  if (state.choosing)
    return (
      <EducationAddChoice
        onCancel={() => state.setChoosing(false)}
        onEducation={state.startEducation}
        onCourse={state.startCourse}
      />
    );
  return (
    <MobileEducationList
      draft={props.draft}
      importedSources={props.importedSources}
      onEducation={state.education.edit}
      onCourse={state.course.edit}
      onAdd={() => state.setChoosing(true)}
    />
  );
}

export function ProfileMobileProjects(
  props: ProfileMobileDataProps & { readonly initialAdd?: boolean },
) {
  const projects = props.draft.projects ?? [];
  const originOf = useProvenanceLabelOf();
  const editor = useMobileEntryEditor<ResumeProjectInput>(
    (entry) =>
      props.onSectionSave(
        projects.some((item) => item.id === entry.id)
          ? updateProject(props.draft, entry.id, entry)
          : { ...props.draft, projects: [...projects, entry] },
      ),
    () => (props.initialAdd ? addProject(props.draft).projects?.at(-1) : undefined),
  );
  if (editor.entry)
    return (
      <ProjectEditForm
        entry={editor.entry}
        saving={props.saving}
        onSave={editor.save}
        onCancel={editor.cancel}
      />
    );
  return (
    <ProfileMobileGroup>
      {projects.map((entry) => (
        <ProfileMobileRow
          key={entry.id}
          icon={Target}
          title={entry.name || 'Название не указано'}
          detail={[
            entry.description,
            entry.employer,
            projectPeriod(entry.startDate, entry.endDate),
            originOf(entry.evidenceMemoryId ?? `manual-${entry.id}`),
          ]
            .filter(Boolean)
            .join(' · ')}
          onClick={() => editor.edit(entry)}
        />
      ))}
      <ProfileMobileRow
        icon={Plus}
        title="Добавить проект"
        onClick={() => editor.edit(addProject(props.draft).projects!.at(-1)!)}
      />
    </ProfileMobileGroup>
  );
}

export function ProfileMobileLanguages(
  props: ProfileMobileDataProps & { readonly initialAdd?: boolean },
) {
  const originOf = useProvenanceLabelOf();
  const editor = useMobileEntryEditor<ResumeLanguageInput>(
    (entry) =>
      props.onSectionSave(
        props.draft.languages.some((item) => item.id === entry.id)
          ? updateLanguage(props.draft, entry.id, entry)
          : { ...props.draft, languages: [...props.draft.languages, entry] },
      ),
    () =>
      props.initialAdd
        ? addLanguage(props.draft, `manual-${crypto.randomUUID()}`).languages.at(-1)
        : undefined,
  );
  if (editor.entry)
    return (
      <LanguageEditForm
        entry={editor.entry}
        saving={props.saving}
        onSave={editor.save}
        onCancel={editor.cancel}
      />
    );
  return (
    <ProfileMobileGroup>
      {props.draft.languages.map((entry) => (
        <ProfileMobileRow
          key={entry.id}
          icon={Translate}
          title={languageName(entry.name ?? '')}
          detail={originOf(entry.evidenceMemoryId)}
          value={mobileLanguageLevel(entry)}
          onClick={() => editor.edit(entry)}
        />
      ))}
      <ProfileMobileRow
        icon={Plus}
        title="Добавить язык"
        onClick={() =>
          editor.edit(addLanguage(props.draft, `manual-${crypto.randomUUID()}`).languages.at(-1)!)
        }
      />
    </ProfileMobileGroup>
  );
}

function mobileLanguageLevel(entry: ResumeLanguageInput): string {
  if (entry.cefr) return `${CEFR_LABELS[entry.cefr]}, ${entry.cefr}`;
  return entry.sourceLabel?.trim() === 'родной' ? 'родной' : 'Уровень не указан';
}
