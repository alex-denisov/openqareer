import type { CandidateMemory } from '../coach/coachApi';
import {
  EntryUnknowns,
  EvidenceChip,
  EvidencePicker,
  Field,
  RemoveButton,
} from './ResumeDocumentParts';
import { ResumeExperienceEntry } from './ResumeExperienceEntry';
import {
  mergeEducation,
  mergeExperience,
  mergeLanguages,
  usedEvidenceIds,
} from './resumeDocumentRows';
import type { CefrLevel, ResumeDocument, ResumeDraft } from './resumeTypes';

const CEFR_LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export interface ResumeDocumentEditor {
  readonly onCandidate: (patch: {
    fullName?: string;
    email?: string;
    phone?: string;
    location?: string;
    links?: readonly string[];
  }) => void;
  readonly onTargetRole: (value: string) => void;
  readonly onAddExperience: (memoryId: string) => void;
  readonly onExperience: (
    id: string,
    patch: {
      title?: string;
      employer?: string;
      location?: string;
      startDate?: string;
      endDate?: string;
      current?: boolean;
    },
  ) => void;
  readonly onRemoveExperience: (id: string) => void;
  readonly onToggleBullet: (experienceId: string, memoryId: string) => void;
  readonly onAddEducation: (memoryId: string) => void;
  readonly onEducation: (
    id: string,
    patch: {
      institution?: string;
      qualification?: string;
      startDate?: string;
      endDate?: string;
    },
  ) => void;
  readonly onRemoveEducation: (id: string) => void;
  readonly onAddLanguage: (memoryId: string) => void;
  readonly onLanguage: (id: string, patch: { name?: string; cefr?: CefrLevel }) => void;
  readonly onRemoveLanguage: (id: string) => void;
}

interface ResumeDocumentViewProps {
  readonly draft: ResumeDraft;
  readonly document: ResumeDocument;
  readonly evidence: readonly CandidateMemory[];
  readonly editor?: ResumeDocumentEditor;
}

interface SectionProps extends ResumeDocumentViewProps {
  readonly available: readonly CandidateMemory[];
}

/**
 * The document is the form. A resume tool that shows a form on the left and a
 * dead preview on the right forces the candidate to hold two models of the same
 * page; here an unknown stands as an editable slot exactly where the gap will
 * be, which is the only honest way to show "this fact is missing".
 */
export function ResumeDocumentView(props: ResumeDocumentViewProps) {
  const used = usedEvidenceIds(props.draft);
  const available = props.evidence.filter((item) => !used.has(item.id));
  const sectionProps: SectionProps = { ...props, available };
  return (
    <article className="career-resume-document" aria-label="Резюме">
      <IdentitySection {...sectionProps} />
      <ExperienceSection {...sectionProps} />
      <EducationSection {...sectionProps} />
      <LanguagesSection {...sectionProps} />
    </article>
  );
}

function IdentitySection({ draft, document, editor }: SectionProps) {
  const contact = draft.candidate.contact;
  return (
    <section className="career-resume-identity">
      <Field
        label="Имя и фамилия"
        value={draft.candidate.fullName ?? ''}
        placeholder="Не указано"
        large
        readOnly={!editor}
        onChange={(value) => editor?.onCandidate({ fullName: value })}
      />
      <Field
        label="Целевая роль"
        value={draft.targetRole ?? ''}
        placeholder="Например, Product Analyst"
        readOnly={!editor}
        onChange={(value) => editor?.onTargetRole(value)}
      />
      <ContactGrid contact={contact} editor={editor} />
      <EntryUnknowns unknowns={document.unknowns.filter((item) => !item.entryId)} />
    </section>
  );
}

function ContactGrid({
  contact,
  editor,
}: {
  contact?: ResumeDraft['candidate']['contact'];
  editor?: ResumeDocumentEditor;
}) {
  return (
    <div className="career-resume-contact-grid">
      <Field
        label="Email"
        type="email"
        value={contact?.email ?? ''}
        placeholder="Не указан"
        readOnly={!editor}
        onChange={(value) => editor?.onCandidate({ email: value })}
      />
      <Field
        label="Телефон"
        value={contact?.phone ?? ''}
        placeholder="Не указан"
        readOnly={!editor}
        onChange={(value) => editor?.onCandidate({ phone: value })}
      />
      <Field
        label="Город"
        value={contact?.location ?? ''}
        placeholder="Не указан"
        readOnly={!editor}
        onChange={(value) => editor?.onCandidate({ location: value })}
      />
      <Field
        label="Ссылка на профиль"
        value={contact?.links?.[0] ?? ''}
        placeholder="https://"
        readOnly={!editor}
        onChange={(value) => editor?.onCandidate({ links: value ? [value] : [] })}
      />
    </div>
  );
}

function ExperienceSection({
  draft,
  document,
  evidence,
  available,
  editor,
}: SectionProps) {
  const rows = mergeExperience(draft, document);
  const statements = new Map(evidence.map((item) => [item.id, item.statement]));
  return (
    <section className="career-resume-section" aria-labelledby="career-resume-experience">
      <h3 id="career-resume-experience">Опыт</h3>
      {rows.length === 0 ? (
        <p className="career-resume-empty">
          Ни одной роли. Добавьте её из подтверждённого факта досье — резюме не
          придумывает историю за вас.
        </p>
      ) : null}
      {rows.map((row) => (
        <ResumeExperienceEntry
          key={row.entry.id}
          entry={row.entry}
          projected={row.projected}
          anchor={statements.get(row.entry.chronologyMemoryId)}
          unknowns={document.unknowns.filter((item) => item.entryId === row.entry.id)}
          available={available}
          editor={editor}
        />
      ))}
      {editor ? (
        <EvidencePicker
          label="Добавить роль из подтверждённого факта"
          options={available}
          onPick={editor.onAddExperience}
        />
      ) : null}
    </section>
  );
}

function EducationSection({ draft, document, available, editor }: SectionProps) {
  const rows = mergeEducation(draft, document);
  return (
    <section className="career-resume-section" aria-labelledby="career-resume-education">
      <h3 id="career-resume-education">Образование</h3>
      {rows.length === 0 ? <p className="career-resume-empty">Не указано.</p> : null}
      {rows.map((entry) => (
        <EducationRow
          key={entry.id}
          entry={entry}
          unknowns={document.unknowns.filter((item) => item.entryId === entry.id)}
          editor={editor}
        />
      ))}
      {editor ? (
        <EvidencePicker
          label="Добавить образование из факта"
          options={available}
          onPick={editor.onAddEducation}
        />
      ) : null}
    </section>
  );
}

function EducationRow({
  entry,
  unknowns,
  editor,
}: {
  entry: ResumeDraft['education'][number];
  unknowns: readonly import('./resumeTypes').ResumeUnknown[];
  editor?: ResumeDocumentEditor;
}) {
  return (
    <div className="career-resume-entry is-compact">
      <EducationFields entry={entry} editor={editor} />
      <EvidenceChip memoryId={entry.evidenceMemoryId} />
      <EntryUnknowns unknowns={unknowns} />
      {editor ? (
        <RemoveButton
          label="Удалить образование"
          onClick={() => editor.onRemoveEducation(entry.id)}
        />
      ) : null}
    </div>
  );
}

function EducationFields({
  entry,
  editor,
}: {
  entry: ResumeDraft['education'][number];
  editor?: ResumeDocumentEditor;
}) {
  return (
    <div className="career-resume-entry-grid">
      <Field
        label="Учебное заведение"
        value={entry.institution ?? ''}
        placeholder="Не указано"
        readOnly={!editor}
        onChange={(value) => editor?.onEducation(entry.id, { institution: value })}
      />
      <Field
        label="Квалификация"
        value={entry.qualification ?? ''}
        placeholder="Не указана"
        readOnly={!editor}
        onChange={(value) => editor?.onEducation(entry.id, { qualification: value })}
      />
      <Field
        label="Начало"
        value={entry.startDate ?? ''}
        placeholder="ГГГГ"
        mono
        readOnly={!editor}
        onChange={(value) => editor?.onEducation(entry.id, { startDate: value })}
      />
      <Field
        label="Окончание"
        value={entry.endDate ?? ''}
        placeholder="ГГГГ"
        mono
        readOnly={!editor}
        onChange={(value) => editor?.onEducation(entry.id, { endDate: value })}
      />
    </div>
  );
}

function LanguagesSection({ draft, document, available, editor }: SectionProps) {
  const rows = mergeLanguages(draft, document);
  return (
    <section className="career-resume-section" aria-labelledby="career-resume-languages">
      <h3 id="career-resume-languages">Языки</h3>
      {rows.length === 0 ? <p className="career-resume-empty">Не указаны.</p> : null}
      {rows.map((entry) => (
        <LanguageRow
          key={entry.id}
          entry={entry}
          unknowns={document.unknowns.filter((item) => item.entryId === entry.id)}
          editor={editor}
        />
      ))}
      {editor ? (
        <EvidencePicker
          label="Добавить язык из факта"
          options={available}
          onPick={editor.onAddLanguage}
        />
      ) : null}
    </section>
  );
}

function LanguageRow({
  entry,
  unknowns,
  editor,
}: {
  entry: ResumeDraft['languages'][number];
  unknowns: readonly import('./resumeTypes').ResumeUnknown[];
  editor?: ResumeDocumentEditor;
}) {
  return (
    <div className="career-resume-entry is-compact">
      <div className="career-resume-entry-grid is-language">
        <Field
          label="Язык"
          value={entry.name ?? ''}
          placeholder="Не указан"
          readOnly={!editor}
          onChange={(value) => editor?.onLanguage(entry.id, { name: value })}
        />
        <label className="career-resume-field">
          <span>Уровень CEFR</span>
          <select
            value={entry.cefr ?? ''}
            disabled={!editor}
            onChange={(event) =>
              editor?.onLanguage(entry.id, {
                cefr: (event.target.value || undefined) as CefrLevel,
              })
            }
          >
            <option value="">Не указан</option>
            {CEFR_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
      <EvidenceChip memoryId={entry.evidenceMemoryId} />
      <EntryUnknowns unknowns={unknowns} />
      {editor ? (
        <RemoveButton
          label="Удалить язык"
          onClick={() => editor.onRemoveLanguage(entry.id)}
        />
      ) : null}
    </div>
  );
}
