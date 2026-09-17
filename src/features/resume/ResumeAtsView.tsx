import { useState, useMemo } from 'react';
import { Check, Copy, DownloadSimple } from '@phosphor-icons/react';
import type { ResumeDocument, ResumeDraft, ResumeExperience, ResumeEducation } from './resumeTypes';
import { resumeExportFileName, triggerFileDownload } from './resumeExport';

export interface ResumeAtsViewProps {
  readonly document: ResumeDocument;
  readonly draft: ResumeDraft;
}

function ResumeAtsActionBar({
  copied,
  onCopy,
  onDownload,
}: {
  readonly copied: boolean;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
}) {
  return (
    <div className="career-resume-ats-actions">
      <div className="career-resume-ats-info">
        <h3>ATS Plain Text</h3>
        <p>
          Моноширинный форматированный текст для корпоративных ATS (Workday, Taleo, Greenhouse, Lever, hh.ru).
        </p>
      </div>
      <div className="career-resume-ats-buttons">
        <button
          type="button"
          className="career-button is-compact career-resume-ats-copy-button"
          onClick={onCopy}
          aria-live="polite"
        >
          {copied ? (
            <>
              <Check size={14} aria-hidden />
              Скопировано!
            </>
          ) : (
            <>
              <Copy size={14} aria-hidden />
              Копировать ATS-текст
            </>
          )}
        </button>
        <button
          type="button"
          className="career-button is-compact career-resume-ats-download-button"
          onClick={onDownload}
        >
          <DownloadSimple size={14} aria-hidden />
          Скачать .txt
        </button>
      </div>
    </div>
  );
}

export function ResumeAtsView({ document, draft }: ResumeAtsViewProps) {
  const [copied, setCopied] = useState(false);

  const atsText = useMemo(() => formatResumeAsAtsText(document, draft), [document, draft]);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(atsText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard error in unsupported environments
    }
  };

  const handleDownload = () => {
    const fileName = resumeExportFileName(document, 'txt');
    triggerFileDownload(fileName, atsText, 'text/plain;charset=utf-8');
  };

  return (
    <div className="career-resume-ats-view" aria-label="ATS Plain Text представление">
      <ResumeAtsActionBar copied={copied} onCopy={handleCopy} onDownload={handleDownload} />
      <div className="career-resume-ats-container">
        <pre className="career-resume-ats-pre">
          <code>{atsText}</code>
        </pre>
      </div>
    </div>
  );
}

function formatAtsHeader(doc: ResumeDocument, draft: ResumeDraft): string | null {
  const fullName = (doc.contact.fullName ?? draft.candidate.fullName ?? '').trim();
  const targetRole = (doc.targetRole ?? draft.targetRole ?? '').trim();
  const contactParts = [
    doc.contact.location ?? draft.candidate.contact?.location,
    doc.contact.phone ?? draft.candidate.contact?.phone,
    doc.contact.email ?? draft.candidate.contact?.email,
    draft.candidate.contact?.telegram,
    doc.contact.links?.[0] ?? draft.candidate.contact?.links?.[0],
  ]
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));

  const headerLines: string[] = [];
  if (fullName) headerLines.push(fullName.toUpperCase());
  if (targetRole) headerLines.push(targetRole);
  if (contactParts.length > 0) headerLines.push(contactParts.join(' | '));
  return headerLines.length > 0 ? headerLines.join('\n') : null;
}

function formatAtsLanguages(doc: ResumeDocument, draft: ResumeDraft): string | null {
  const languagesList = (doc.languages.length > 0 ? doc.languages : draft.languages ?? [])
    .map((l) => {
      const name =
        'name' in l && typeof l.name === 'object' && l.name !== null
          ? l.name.value
          : (l as { name?: string }).name;
      const cefr =
        'cefr' in l && typeof l.cefr === 'object' && l.cefr !== null
          ? l.cefr.value
          : (l as { cefr?: string }).cefr;
      const trimmedName = name?.trim();
      if (!trimmedName) return '';
      return cefr ? `${trimmedName} (${cefr})` : trimmedName;
    })
    .filter(Boolean);

  return languagesList.length > 0 ? `=== LANGUAGES ===\n${languagesList.join(', ')}` : null;
}

function formatAtsCourses(doc: ResumeDocument, draft: ResumeDraft): string | null {
  const coursesList = (doc.courses ?? draft.courses ?? [])
    .map((c) => {
      const parts = [
        c.name?.trim(),
        (c.provider ?? c.institution)?.trim(),
        c.year ? String(c.year) : '',
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean);

  return coursesList.length > 0
    ? `=== COURSES AND CERTIFICATIONS ===\n${coursesList.join('\n')}`
    : null;
}

export function formatResumeAsAtsText(doc: ResumeDocument, draft: ResumeDraft): string {
  const sections: string[] = [];

  const header = formatAtsHeader(doc, draft);
  if (header) sections.push(header);

  const about = (doc.about ?? draft.candidate.about ?? '').trim();
  if (about) sections.push(`=== SUMMARY ===\n${about}`);

  const experienceBlocks = formatAtsExperience(doc.experience);
  if (experienceBlocks) sections.push(`=== WORK EXPERIENCE ===\n\n${experienceBlocks}`);

  const skillsList = (doc.skills ?? draft.skills ?? [])
    .map((s) => s.name?.trim())
    .filter((s): s is string => Boolean(s));
  if (skillsList.length > 0) sections.push(`=== SKILLS ===\n${skillsList.join(', ')}`);

  const educationBlocks = formatAtsEducation(doc.education);
  if (educationBlocks) sections.push(`=== EDUCATION ===\n\n${educationBlocks}`);

  const languages = formatAtsLanguages(doc, draft);
  if (languages) sections.push(languages);

  const courses = formatAtsCourses(doc, draft);
  if (courses) sections.push(courses);

  return sections.join('\n\n');
}

function formatAtsExperience(experiences: readonly ResumeExperience[]): string {
  if (!experiences.length) return '';
  return experiences
    .map((exp) => {
      const title = exp.title?.value?.trim() ?? '';
      const employer = exp.employer?.value?.trim() ?? '';
      const location = exp.location?.value?.trim() ?? '';
      const headerLine = [title, employer, location].filter(Boolean).join(' | ');

      const start = exp.startDate?.value?.trim();
      const isCurrent = exp.current?.value;
      const end = isCurrent ? 'Present' : exp.endDate?.value?.trim();
      const periodLine = start && end ? `${start} - ${end}` : (start ?? end ?? '');

      const bullets = exp.bullets
        .map((b) => b.value?.trim())
        .filter(Boolean)
        .map((b) => `- ${b}`);

      return [headerLine, periodLine, ...bullets].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function formatAtsEducation(education: readonly ResumeEducation[]): string {
  if (!education.length) return '';
  return education
    .map((edu) => {
      const inst = edu.institution?.value?.trim();
      const qual = edu.qualification?.value?.trim();
      const start = edu.startDate?.value?.trim();
      const end = edu.endDate?.value?.trim();
      const period = start && end ? `${start} - ${end}` : (start ?? end ?? '');

      return [inst, qual, period].filter(Boolean).join(' | ');
    })
    .filter(Boolean)
    .join('\n');
}
