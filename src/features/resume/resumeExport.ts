import type { ResumeDocument, ResumeDraft, ResumeExperience, ResumeEducation } from './resumeTypes';
import { sanitizeForThirdPartyExport } from '../../../shared/workPreferences';
import type { TargetedResumeSlice } from './resumeTypes';

/**
 * Generates clean, ATS-optimized plain text from a ResumeDocument.
 *
 * Adheres to standard ATS conventions:
 * - Clear, standard section headers without decorative symbols.
 * - Reverse chronological ordering.
 * - Standard hyphen bullet points.
 * - Contacts and location on single lines.
 */
import {
  formatResumeAsAtsText as formatResumeAsAtsTextCore,
  formatTargetedResumeAsAtsText as formatTargetedResumeAsAtsTextCore,
} from '../../../server/domain/resumeAtsText';

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

  const skills = (doc.skills ?? [])
    .map((s) => s.name?.trim())
    .filter((s): s is string => Boolean(s));
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
      const description = exp.description?.value.trim();
      const bullets = exp.bullets
        .map((b) => b.value?.trim())
        .filter(Boolean)
        .map((b) => `- ${b}`);

      const parts = [titleLine, period, description, ...bullets].filter(Boolean);
      return parts.join('\n');
    })
    .filter(Boolean);

  return blocks.length ? `ОПЫТ РАБОТЫ\n\n${blocks.join('\n\n')}` : '';
}

export function formatExperiencePeriod(exp: ResumeExperience): string {
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
    .map((language) => {
      const name = language.name?.value?.trim();
      const cefr = language.cefr?.value?.trim();
      if (!name) return '';
      if (cefr) return `${name} (${cefr})`;
      return language.native?.value === 'native' ? `${name} (родной)` : name;
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
      const author = [authorName, r.role?.trim(), r.organization?.trim()]
        .filter(Boolean)
        .join(', ');
      const text = (r.text ?? '').trim();
      if (!author && !text) return '';
      return author && text ? `${author}\n${text}` : author || text;
    })
    .filter(Boolean);

  return items.length ? `РЕКОМЕНДАЦИИ\n\n${items.join('\n\n')}` : '';
}

/**
 * Serializes the ResumeDocument to formatted JSON with 2-space indentation.
 */
export function exportResumeAsJson(doc: ResumeDocument): string {
  // B384: граница внешней выгрузки — поля профиля ограничений не покидают приложение.
  return JSON.stringify(sanitizeForThirdPartyExport(doc as unknown as Record<string, unknown>), null, 2);
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

export function resumeTargetedExportFileName(
  doc: ResumeDocument,
  ext: 'txt' | 'pdf',
): string {
  return resumeExportFileName(doc, ext).replace(/^resume-(?:master|germany)-/u, 'resume-targeted-');
}

const RU_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function slugifyLatin(text: string): string {
  const lower = text.toLowerCase();
  let translit = '';
  for (const char of lower) {
    translit += RU_TO_LATIN[char] ?? char;
  }
  return translit.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'resume';
}

/**
 * Triggers a browser file download for text/json content.
 */
export async function triggerFileDownload(
  fileName: string,
  content: string,
  mimeType: string,
): Promise<string | null> {
  if (isTauriEnvironment()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const extension = fileName.split('.').at(-1) ?? 'txt';
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path) return null;
    await writeTextFile(path, content);
    return path;
  }
  if (typeof document === 'undefined') return null;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return null;
}

/**
 * Triggers browser native print for PDF saving.
 */
export async function triggerResumePrint(): Promise<boolean> {
  if (isTauriEnvironment()) {
    // false — кандидат нажал «Отмена» в окне печати; сбой приходит отказом invoke.
    const printed = await invokeDesktopCommand<boolean>('print_resume');
    return printed === true;
  }
  if (typeof window === 'undefined') return false;
  window.print();
  return true;
}

export async function saveResumeAsPdf(
  fileName = 'openqareer-resume.pdf',
): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: fileName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!path) return null;
  const saved = await invokeDesktopCommand<boolean>('save_resume_pdf', { path });
  if (saved !== true) throw new Error('native_pdf_save_failed');
  return path;
}

/**
 * The visible ATS panel and the downloaded file must be the same artifact.
 * Keeping the formatter here prevents the header action from quietly falling
 * back to the older human-readable export.
 */
export function formatResumeAsAtsText(doc: ResumeDocument, draft: ResumeDraft): string {
  return formatResumeAsAtsTextCore(doc, draft);
}

export function formatTargetedResumeAsAtsText(slice: TargetedResumeSlice): string {
  return formatTargetedResumeAsAtsTextCore(slice);
}

import { isTauriEnvironment, invokeDesktopCommand } from '../../services/desktop/desktopBridge';
