import type {
  ResumeDocument,
  ResumeDraft,
  ResumeExperience,
  ResumeEducation,
} from './resumeTypes';

/**
 * Generates clean, ATS-optimized plain text from a ResumeDocument.
 *
 * Adheres to standard ATS conventions:
 * - Clear, standard section headers without decorative symbols.
 * - Reverse chronological ordering.
 * - Standard hyphen bullet points.
 * - Contacts and location on single lines.
 */
export function exportResumeAsPlainText(doc: ResumeDocument): string {
  const sections: string[] = [];

  const header = buildHeader(doc);
  if (header) sections.push(header);

  const about = doc.about?.trim();
  if (about) {
    sections.push(`ОБО МНЕ\n${about}`);
  }

  const experience = buildExperienceSection(doc.experience);
  if (experience) sections.push(experience);

  const education = buildEducationSection(doc.education);
  if (education) sections.push(education);

  const skills = (doc.skills ?? []).map((s) => s.name?.trim()).filter((s): s is string => Boolean(s));
  if (skills.length > 0) {
    sections.push(`НАВЫКИ\n${skills.join(', ')}`);
  }

  const languages = buildLanguagesSection(doc);
  if (languages) sections.push(languages);

  const courses = buildCoursesSection(doc);
  if (courses) sections.push(courses);

  const recommendations = buildRecommendationsSection(doc);
  if (recommendations) sections.push(recommendations);

  return sections.join('\n\n---\n\n');
}

function buildHeader(doc: ResumeDocument): string {
  const lines: string[] = [];
  const name = doc.contact.fullName?.trim();
  if (name) lines.push(name.toUpperCase());

  const role = doc.targetRole?.trim();
  if (role) lines.push(role);

  const contacts = [
    doc.contact.location?.trim(),
    doc.contact.email?.trim(),
    doc.contact.phone?.trim(),
    doc.contact.telegram?.trim(),
  ].filter((item): item is string => Boolean(item));

  if (contacts.length > 0) {
    lines.push(contacts.join(' | '));
  }

  return lines.join('\n');
}

function buildExperienceSection(experiences: readonly ResumeExperience[]): string {
  if (!experiences.length) return '';
  const blocks = experiences
    .map((exp) => {
      const headerParts = [exp.title?.value?.trim(), exp.employer?.value?.trim()].filter(Boolean);
      const titleLine = headerParts.join(' — ');
      const period = formatExperiencePeriod(exp);
      const bullets = exp.bullets
        .map((b) => b.value?.trim())
        .filter(Boolean)
        .map((b) => `- ${b}`);

      const parts = [titleLine, period, ...bullets].filter(Boolean);
      return parts.join('\n');
    })
    .filter(Boolean);

  return blocks.length ? `ОПЫТ РАБОТЫ\n\n${blocks.join('\n\n')}` : '';
}

function formatExperiencePeriod(exp: ResumeExperience): string {
  const start = exp.startDate?.value?.trim();
  const isCurrent = exp.current?.value;
  const end = isCurrent ? 'настоящее время' : exp.endDate?.value?.trim();
  if (!start && !end) return '';
  if (start && end) return `${start} — ${end}`;
  return start ?? end ?? '';
}

function buildEducationSection(education: readonly ResumeEducation[]): string {
  if (!education.length) return '';
  const blocks = education
    .map((edu) => {
      const inst = edu.institution?.value?.trim();
      const qual = edu.qualification?.value?.trim();
      const start = edu.startDate?.value?.trim();
      const end = edu.endDate?.value?.trim();
      const period = start && end ? `${start} — ${end}` : (start ?? end ?? '');

      const lines = [inst, qual, period].filter(Boolean);
      return lines.join('\n');
    })
    .filter(Boolean);

  return blocks.length ? `ОБРАЗОВАНИЕ\n\n${blocks.join('\n\n')}` : '';
}

function buildLanguagesSection(doc: ResumeDocument): string {
  if (!doc.languages.length) return '';
  const items = doc.languages
    .map((l) => {
      const name = l.name?.value?.trim();
      const cefr = l.cefr?.value?.trim();
      if (!name) return '';
      return cefr ? `${name} (${cefr})` : name;
    })
    .filter(Boolean);

  return items.length ? `ЯЗЫКИ\n${items.join(', ')}` : '';
}

function buildCoursesSection(doc: ResumeDocument): string {
  if (!doc.courses?.length) return '';
  const items = doc.courses
    .map((c) => {
      const yearStr = c.year !== undefined ? String(c.year).trim() : '';
      const parts = [c.name.trim(), c.institution?.trim(), yearStr].filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean);

  return items.length ? `КУРСЫ\n${items.join('\n')}` : '';
}

function buildRecommendationsSection(doc: ResumeDocument): string {
  if (!doc.recommendations?.length) return '';
  const items = doc.recommendations
    .map((r) => {
      const authorName = (r.author ?? r.recommender ?? '').trim();
      const author = [authorName, r.role?.trim(), r.organization?.trim()].filter(Boolean).join(', ');
      const text = (r.text ?? '').trim();
      if (!author && !text) return '';
      return author && text ? `${author}\n${text}` : (author || text);
    })
    .filter(Boolean);

  return items.length ? `РЕКОМЕНДАЦИИ\n\n${items.join('\n\n')}` : '';
}

/**
 * Serializes the ResumeDocument to formatted JSON with 2-space indentation.
 */
export function exportResumeAsJson(doc: ResumeDocument): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Generates a URL/filesystem-safe file name for export.
 */
export function resumeExportFileName(doc: ResumeDocument, ext: 'txt' | 'json' | 'pdf'): string {
  const variant = doc.kind === 'country-role' ? 'germany' : 'master';
  const rawName = doc.contact.fullName?.trim();
  const slug = rawName ? slugifyLatin(rawName) : 'resume';
  return `resume-${variant}-${slug}.${ext}`;
}

const RU_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya',
};

function slugifyLatin(text: string): string {
  const lower = text.toLowerCase();
  let translit = '';
  for (const char of lower) {
    translit += RU_TO_LATIN[char] ?? char;
  }
  return translit
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'resume';
}

/**
 * Triggers a browser file download for text/json content.
 */
export function triggerFileDownload(fileName: string, content: string, mimeType: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Triggers browser native print for PDF saving.
 */
export function triggerResumePrint(): void {
  if (typeof window !== 'undefined') {
    window.print();
  }
}

/**
 * The visible ATS panel and the downloaded file must be the same artifact.
 * Keeping the formatter here prevents the header action from quietly falling
 * back to the older human-readable export.
 */
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
