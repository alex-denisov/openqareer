import { mergeEducation, mergeExperience, mergeLanguages } from './resumeDocumentRows';
import type { ReactNode } from 'react';
import { formatExperiencePeriod } from './resumeExport';
import type { ResumeDocument, ResumeDraft } from './resumeTypes';

interface ResumePrintDocumentProps {
  readonly document: ResumeDocument;
  readonly draft: ResumeDraft;
}

const clean = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value).trim();

const joined = (parts: readonly (string | number | null | undefined)[], sep: string): string =>
  parts.map(clean).filter(Boolean).join(sep);

function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="career-resume-print-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function PrintHeader({ document, draft }: ResumePrintDocumentProps) {
  const contact = draft.candidate.contact;
  const name = clean(draft.candidate.fullName) || clean(document.contact.fullName);
  const role = clean(draft.targetRole) || clean(document.targetRole);
  const city = clean(contact?.location) || clean(document.contact.location);
  const contacts = joined(
    [
      contact?.phone ?? document.contact.phone,
      contact?.email ?? document.contact.email,
      document.contact.telegram,
      contact?.links?.[0] ?? document.contact.links?.[0],
    ],
    '   ∙   ',
  );
  const subtitle = joined([role, city], ' | ');
  return (
    <header className="career-resume-print-header">
      {name ? <h1>{name}</h1> : null}
      {subtitle ? <p>{subtitle}</p> : null}
      {contacts ? <p>{contacts}</p> : null}
    </header>
  );
}

function draftPeriod(start?: string, end?: string, current?: boolean): string {
  if (!start && !end) return '';
  return joined([start, current ? 'по настоящее время' : end], ' — ');
}

/** Опыт как на экране: проекция документа плюс записи черновика (mergeExperience). */
function PrintExperience({ document, draft }: { document: ResumeDocument; draft: ResumeDraft }) {
  const entries = mergeExperience(draft, document)
    .map(({ entry, projected }) => ({
      id: entry.id,
      heading: joined([entry.title, entry.employer], ' — '),
      period: projected
        ? formatExperiencePeriod(projected)
        : draftPeriod(entry.startDate, entry.endDate, entry.current),
      bullets: (projected?.bullets ?? []).map((b) => clean(b.value)).filter(Boolean),
    }))
    .filter((entry) => entry.heading || entry.period || entry.bullets.length > 0);
  if (entries.length === 0) return null;
  return (
    <PrintSection title="Опыт работы">
      {entries.map((entry) => (
        <article key={entry.id} className="career-resume-print-entry">
          {entry.heading ? <h3>{entry.heading}</h3> : null}
          {entry.period ? <p className="career-resume-print-period">{entry.period}</p> : null}
          {entry.bullets.length > 0 ? (
            <ul>
              {entry.bullets.map((bullet, index) => (
                <li key={`${entry.id}-${index}`}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </PrintSection>
  );
}

function PrintLines({ title, lines }: { title: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <PrintSection title={title}>
      {lines.map((line, index) => (
        <p key={`${title}-${index}`}>{line}</p>
      ))}
    </PrintSection>
  );
}

function educationLines(document: ResumeDocument, draft: ResumeDraft): string[] {
  return mergeEducation(draft, document)
    .map((edu) =>
      joined(
        [edu.institution, edu.qualification, joined([edu.startDate, edu.endDate], ' — ')],
        ', ',
      ),
    )
    .filter(Boolean);
}

function recommendationLines(document: ResumeDocument): string[] {
  return (document.recommendations ?? [])
    .map((rec) => {
      const author = joined([rec.author ?? rec.recommender, rec.role, rec.organization], ', ');
      return joined([author, rec.text], ': ');
    })
    .filter(Boolean);
}

/**
 * Read-only Stanford-style resume for paper. The on-screen document is built
 * from editable inputs and carries editor hints; print needs only facts, so
 * every empty section and placeholder is dropped here, not hidden by CSS.
 */
export function ResumePrintDocument({ document, draft }: ResumePrintDocumentProps) {
  const about = clean(draft.candidate.about) || clean(document.about);
  const skills = joined(
    (document.skills ?? []).map((skill) => skill.name),
    ', ',
  );
  const languages = joined(
    mergeLanguages(draft, document).map((lang) =>
      lang.name ? joined([lang.name, lang.cefr ? `(${lang.cefr})` : ''], ' ') : '',
    ),
    ', ',
  );
  const courses = (document.courses ?? [])
    .map((course) =>
      joined([course.name, course.institution ?? course.provider, course.year], ' | '),
    )
    .filter(Boolean);
  return (
    <article className="career-resume-print" aria-hidden="true">
      <PrintHeader document={document} draft={draft} />
      {about ? (
        <PrintSection title="Обо мне">
          <p>{about}</p>
        </PrintSection>
      ) : null}
      <PrintExperience document={document} draft={draft} />
      <PrintLines title="Навыки" lines={skills ? [skills] : []} />
      <PrintLines title="Образование" lines={educationLines(document, draft)} />
      <PrintLines title="Курсы" lines={courses} />
      <PrintLines title="Языки" lines={languages ? [languages] : []} />
      <PrintLines title="Рекомендации" lines={recommendationLines(document)} />
    </article>
  );
}
