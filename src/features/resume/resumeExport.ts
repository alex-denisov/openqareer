import type { ResumeDocument, ResumeExperience, ResumeEducation } from './resumeTypes';

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

  const about = doc.candidate.about?.trim();
  if (about) {
    sections.push(`ОБО МНЕ\n${about}`);
  }

  const experience = buildExperienceSection(doc.experience);
  if (experience) sections.push(experience);

  const education = buildEducationSection(doc.education);
  if (education) sections.push(education);

  const skills = doc.skills.map((s) => s.name.trim()).filter(Boolean);
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
  const name = doc.candidate.fullName?.value?.trim();
  if (name) lines.push(name.toUpperCase());

  const role = doc.targetRole?.trim();
  if (role) lines.push(role);

  const contacts = [
    doc.candidate.location?.value?.trim(),
    doc.candidate.email?.value?.trim(),
    doc.candidate.phone?.value?.trim(),
    doc.candidate.telegram?.value?.trim(),
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
  if (!doc.courses.length) return '';
  const items = doc.courses
    .map((c) => {
      const parts = [c.name.trim(), c.institution?.trim(), c.year?.trim()].filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean);

  return items.length ? `КУРСЫ\n${items.join('\n')}` : '';
}

function buildRecommendationsSection(doc: ResumeDocument): string {
  if (!doc.recommendations.length) return '';
  const items = doc.recommendations
    .map((r) => {
      const author = [r.author.trim(), r.role?.trim(), r.company?.trim()].filter(Boolean).join(', ');
      return `${author}\n${r.text.trim()}`;
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
  const variant = doc.variant === 'germany' ? 'germany' : 'master';
  const rawName = doc.candidate.fullName?.value?.trim();
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
