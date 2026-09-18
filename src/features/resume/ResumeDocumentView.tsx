import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import type { CandidateMemory } from '../coach/coachApi';
import {
  EntryUnknowns,
  EvidenceChip,
  EvidencePicker,
  Field,
  RemoveButton,
  TextAreaField,
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
    photoUrl?: string;
    about?: string;
    email?: string;
    phone?: string;
    telegram?: string;
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
  readonly onAddSkill: (name: string, level?: string) => void;
  readonly onRemoveSkill: (id: string) => void;
  readonly onAddCourse: (name: string, institution?: string, year?: string) => void;
  readonly onRemoveCourse: (id: string) => void;
  readonly onAddTest: (name: string, provider?: string, score?: string) => void;
  readonly onRemoveTest: (id: string) => void;
  readonly onAddRecommendation: (recommender: string, organization?: string) => void;
  readonly onRemoveRecommendation: (id: string) => void;
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
      <SkillsSection {...sectionProps} />
      <EducationSection {...sectionProps} />
      <CoursesSection {...sectionProps} />
      <TestsSection {...sectionProps} />
      <RecommendationsSection {...sectionProps} />
      <LanguagesSection {...sectionProps} />
    </article>
  );
}

function StanfordHeader({
  fullName,
  targetRole,
  location,
  contactParts,
}: {
  fullName: string;
  targetRole: string;
  location?: string | null;
  contactParts: readonly string[];
}) {
  return (
    <div className="career-resume-stanford-header">
      <h1 className="career-resume-stanford-name">{fullName}</h1>
      <div className="career-resume-stanford-subtitle">
        <span>{targetRole}</span>
        {location ? <span> | {location}</span> : null}
      </div>
      <div className="career-resume-stanford-contacts">
        {contactParts.length > 0 ? (
          <span>{contactParts.join('   ∙   ')}</span>
        ) : (
          <span className="career-resume-dim">Контакты не указаны</span>
        )}
      </div>
    </div>
  );
}

function IdentitySection({ draft, document, editor }: SectionProps) {
  const contact = draft.candidate.contact;
  const contactParts = [
    contact?.location ?? document.contact.location,
    contact?.phone ?? document.contact.phone,
    contact?.email ?? document.contact.email,
    contact?.links?.[0] ?? document.contact.links?.[0],
  ]
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));

  return (
    <section className="career-resume-identity">
      <StanfordHeader
        fullName={draft.candidate.fullName || document.contact.fullName || 'Имя Фамилия'}
        targetRole={draft.targetRole || document.targetRole || 'Целевая роль'}
        location={contact?.location}
        contactParts={contactParts}
      />

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
      <ContactGrid contact={contact} photoUrl={draft.candidate.photoUrl} editor={editor} />
      <div className="career-resume-section">
        <h3 id="career-resume-summary">SUMMARY</h3>
        <TextAreaField
          label="О себе"
          value={draft.candidate.about ?? ''}
          placeholder="Краткое резюме опыта, ключевых компетенций и профессиональных приоритетов..."
          readOnly={!editor}
          onChange={(value) => editor?.onCandidate({ about: value })}
        />
      </div>
      <EntryUnknowns unknowns={document.unknowns.filter((item) => !item.entryId)} />
    </section>
  );
}

// eslint-disable-next-line max-lines-per-function
function ContactGrid({
  contact,
  photoUrl,
  editor,
}: {
  contact?: ResumeDraft['candidate']['contact'];
  photoUrl?: string;
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
        label="Telegram"
        value={contact?.telegram ?? ''}
        placeholder="@username"
        readOnly={!editor}
        onChange={(value) => editor?.onCandidate({ telegram: value })}
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
      <Field
        label="Фото / Аватар (URL)"
        value={photoUrl ?? ''}
        placeholder="https://"
        readOnly={!editor}
        onChange={(value) => editor?.onCandidate({ photoUrl: value })}
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
      <h3 id="career-resume-experience">PROFESSIONAL EXPERIENCE</h3>
      {rows.length === 0 ? (
        <p className="career-resume-empty">
          Ни одной роли. Добавьте её из подтверждённого факта — резюме не
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

// eslint-disable-next-line max-lines-per-function
function SkillsSection({ draft, editor }: SectionProps) {
  const [newSkill, setNewSkill] = useState('');
  const skills = draft.skills ?? [];

  function handleAdd() {
    const trimmed = newSkill.trim();
    if (!trimmed) return;
    editor?.onAddSkill(trimmed);
    setNewSkill('');
  }

  return (
    <section className="career-resume-section" aria-labelledby="career-resume-skills">
      <h3 id="career-resume-skills">SKILLS</h3>
      {skills.length === 0 ? (
        <p className="career-resume-empty">Навыки не указаны.</p>
      ) : (
        <div className="career-resume-skills-grid">
          {skills.map((skill) => (
            <span
              key={skill.id}
              className="career-chip"
            >
              <span>{skill.name}</span>
              {editor ? (
                <button
                  type="button"
                  onClick={() => editor.onRemoveSkill(skill.id)}
                  className="career-chip-remove"
                  title="Удалить навык"
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      )}
      {editor ? (
        <div className="career-resume-inline-add">
          <input
            type="text"
            className="career-resume-inline-input"
            value={newSkill}
            placeholder="Новый навык (например, Product Management)"
            onChange={(e) => setNewSkill(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <button
            type="button"
            className="career-button is-compact"
            onClick={handleAdd}
            disabled={!newSkill.trim()}
          >
            <Plus size={14} /> Добавить
          </button>
        </div>
      ) : null}
    </section>
  );
}

function EducationSection({ draft, document, available, editor }: SectionProps) {
  const rows = mergeEducation(draft, document);
  return (
    <section className="career-resume-section" aria-labelledby="career-resume-education">
      <h3 id="career-resume-education">EDUCATION AND CERTIFICATIONS</h3>
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

// eslint-disable-next-line max-lines-per-function
function CoursesSection({ draft, editor }: SectionProps) {
  const [courseName, setCourseName] = useState('');
  const [institution, setInstitution] = useState('');
  const [year, setYear] = useState('');
  const courses = draft.courses ?? [];

  function handleAdd() {
    if (!courseName.trim()) return;
    editor?.onAddCourse(courseName.trim(), institution.trim() || undefined, year.trim() || undefined);
    setCourseName('');
    setInstitution('');
    setYear('');
  }

  return (
    <section className="career-resume-section" aria-labelledby="career-resume-courses">
      <h3 id="career-resume-courses">Курсы и сертификаты</h3>
      {courses.length === 0 ? (
        <p className="career-resume-empty">Курсы и сертификаты не указаны.</p>
      ) : null}
      {courses.map((course) => (
        <div key={course.id} className="career-resume-entry is-compact">
          <div className="career-resume-entry-grid">
            <Field
              label="Название курса / сертификата"
              value={course.name}
              placeholder="Например, Reforge Product Leadership"
              readOnly={true}
              onChange={() => {}}
            />
            <Field
              label="Организация"
              value={course.provider ?? course.institution ?? ''}
              placeholder="Не указана"
              readOnly={true}
              onChange={() => {}}
            />
            <Field
              label="Год"
              value={course.year ? String(course.year) : ''}
              placeholder="ГГГГ"
              mono
              readOnly={true}
              onChange={() => {}}
            />
          </div>
          {editor ? (
            <RemoveButton
              label="Удалить курс"
              onClick={() => editor.onRemoveCourse(course.id)}
            />
          ) : null}
        </div>
      ))}
      {editor ? (
        <div className="career-resume-grid-4col">
          <input
            type="text"
            className="career-resume-grid-input"
            value={courseName}
            placeholder="Название курса"
            onChange={(e) => setCourseName(e.target.value)}
          />
          <input
            type="text"
            className="career-resume-grid-input"
            value={institution}
            placeholder="Платформа / Вуз"
            onChange={(e) => setInstitution(e.target.value)}
          />
          <input
            type="text"
            className="career-resume-grid-input"
            value={year}
            placeholder="Год"
            onChange={(e) => setYear(e.target.value)}
          />
          <button
            type="button"
            className="career-button is-compact"
            onClick={handleAdd}
            disabled={!courseName.trim()}
          >
            <Plus size={14} /> Добавить
          </button>
        </div>
      ) : null}
    </section>
  );
}

function TestsSection({ draft, editor }: SectionProps) {
  const tests = draft.tests ?? [];
  const [testName, setTestName] = useState('');
  const [score, setScore] = useState('');

  function handleAdd() {
    if (!testName.trim()) return;
    editor?.onAddTest(testName.trim(), undefined, score.trim() || undefined);
    setTestName('');
    setScore('');
  }

  return (
    <section className="career-resume-section" aria-labelledby="career-resume-tests">
      <h3 id="career-resume-tests">Тесты и оценки</h3>
      {tests.length === 0 ? <p className="career-resume-empty">Тесты не указаны.</p> : null}
      {tests.map((test) => (
        <div key={test.id} className="career-resume-entry is-compact">
          <div className="career-resume-entry-grid">
            <Field label="Тест / Экзамен" value={test.name} placeholder="GMAT, IELTS..." readOnly={true} onChange={() => {}} />
            <Field label="Организация" value={test.provider ?? ''} placeholder="Не указана" readOnly={true} onChange={() => {}} />
            <Field label="Результат / Балл" value={test.score ?? ''} placeholder="720, 8.5..." readOnly={true} onChange={() => {}} />
          </div>
          {editor ? <RemoveButton label="Удалить тест" onClick={() => editor.onRemoveTest(test.id)} /> : null}
        </div>
      ))}
      {editor ? (
        <div className="career-resume-grid-3col">
          <input
            type="text"
            className="career-resume-grid-input"
            value={testName}
            placeholder="Тест / Экзамен (напр. GMAT, IELTS)"
            onChange={(e) => setTestName(e.target.value)}
          />
          <input
            type="text"
            className="career-resume-grid-input"
            value={score}
            placeholder="Балл / Результат"
            onChange={(e) => setScore(e.target.value)}
          />
          <button type="button" className="career-button is-compact" onClick={handleAdd} disabled={!testName.trim()}>
            <Plus size={14} /> Добавить
          </button>
        </div>
      ) : null}
    </section>
  );
}

// eslint-disable-next-line max-lines-per-function
function RecommendationsSection({ draft, editor }: SectionProps) {
  const recommendations = draft.recommendations ?? [];
  const [recommender, setRecommender] = useState('');
  const [organization, setOrganization] = useState('');

  function handleAdd() {
    if (!recommender.trim()) return;
    editor?.onAddRecommendation(recommender.trim(), organization.trim() || undefined);
    setRecommender('');
    setOrganization('');
  }

  return (
    <section className="career-resume-section" aria-labelledby="career-resume-recommendations">
      <h3 id="career-resume-recommendations">Рекомендации</h3>
      {recommendations.length === 0 ? <p className="career-resume-empty">Рекомендации не указаны.</p> : null}
      {recommendations.map((rec) => (
        <div key={rec.id} className="career-resume-entry is-compact">
          <div className="career-resume-entry-grid">
            <Field label="Рекомендатель" value={rec.recommender ?? rec.author ?? ''} placeholder="ФИО" readOnly={true} onChange={() => {}} />
            <Field label="Организация / Роль" value={rec.organization ?? rec.role ?? ''} placeholder="CTO в TechCorp" readOnly={true} onChange={() => {}} />
          </div>
          {rec.text ? (
            <p className="career-resume-quote">
              «{rec.text}»
            </p>
          ) : null}
          {editor ? <RemoveButton label="Удалить рекомендацию" onClick={() => editor.onRemoveRecommendation(rec.id)} /> : null}
        </div>
      ))}
      {editor ? (
        <div className="career-resume-grid-recommendation">
          <input
            type="text"
            className="career-resume-grid-input"
            value={recommender}
            placeholder="ФИО рекомендателя"
            onChange={(e) => setRecommender(e.target.value)}
          />
          <input
            type="text"
            className="career-resume-grid-input"
            value={organization}
            placeholder="Компания и должность"
            onChange={(e) => setOrganization(e.target.value)}
          />
          <button type="button" className="career-button is-compact" onClick={handleAdd} disabled={!recommender.trim()}>
            <Plus size={14} /> Добавить
          </button>
        </div>
      ) : null}
    </section>
  );
}

function LanguagesSection({ draft, document, available, editor }: SectionProps) {
  const rows = mergeLanguages(draft, document);
  return (
    <section className="career-resume-section" aria-labelledby="career-resume-languages">
      <h3 id="career-resume-languages">LANGUAGES</h3>
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
