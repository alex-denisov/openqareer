import type {
  ParsedResume,
  ParsedResumeEducation,
  ParsedResumeExperience,
  ParsedResumeLanguage,
} from '../../features/workspace/resumeParser';
import type { CefrLevel } from '../../features/resume/resumeTypes';

function extractTagContent(html: string, tagAttrPattern: RegExp): string | null {
  const match = tagAttrPattern.exec(html);
  if (!match) return null;
  const content = match[1] ?? match[2] ?? '';
  return content.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim() || null;
}

function extractAllTagContents(html: string, tagAttrPattern: RegExp): string[] {
  const results: string[] = [];
  const regex = new RegExp(
    tagAttrPattern.source,
    tagAttrPattern.flags.includes('g') ? tagAttrPattern.flags : `${tagAttrPattern.flags}g`,
  );
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const text = (match[1] ?? match[2] ?? '')
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (text && !results.includes(text)) {
      results.push(text);
    }
  }
  return results;
}

// One parser, one document shape: splitting it would scatter the field map.
// eslint-disable-next-line max-lines-per-function
export function parseHhResumeHtml(html: string, sourceUrl: string): ParsedResume {
  const fullName =
    extractTagContent(
      html,
      /data-qa=["']resume-personal-name["'][^>]*>([\s\S]*?)<\/(?:div|span|h\d)>/iu,
    ) ??
    extractTagContent(
      html,
      /<h1[^>]*class=["'][^"']*resume-header[^"']*["'][^>]*>([\s\S]*?)<\/h1>/iu,
    ) ??
    undefined;

  const targetRole =
    extractTagContent(
      html,
      /data-qa=["']resume-block-title-position["'][^>]*>([\s\S]*?)<\/(?:div|span|h\d)>/iu,
    ) ??
    extractTagContent(
      html,
      /data-qa=["']resume-title["'][^>]*>([\s\S]*?)<\/(?:div|span|h\d)>/iu,
    ) ??
    undefined;

  const about =
    extractTagContent(
      html,
      /data-qa=["']resume-block-about["'][^>]*>([\s\S]*?)<\/div>/iu,
    ) ??
    extractTagContent(
      html,
      /data-qa=["']resume-block-skills-content["'][^>]*>([\s\S]*?)<\/div>/iu,
    ) ??
    undefined;

  const skills = extractAllTagContents(
    html,
    /data-qa=["'](?:bloko-tag__text|skills-element)["'][^>]*>([\s\S]*?)<\/span>/iu,
  );

  // Extract Experience items
  const experience: ParsedResumeExperience[] = [];
  const expItems = html.split(/class=["'][^"']*resume-block-item-gap[^"']*["']/giu);
  if (expItems.length > 1) {
    for (let i = 1; i < expItems.length; i += 1) {
      const itemHtml = expItems[i];
      const position =
        extractTagContent(
          itemHtml,
          /data-qa=["']resume-block-experience-position["'][^>]*>([\s\S]*?)<\/div>/iu,
        ) ?? '';
      const company =
        extractTagContent(
          itemHtml,
          /data-qa=["']resume-block-experience-company["'][^>]*>([\s\S]*?)<\/div>/iu,
        ) ?? '';
      const interval =
        extractTagContent(
          itemHtml,
          /data-qa=["']resume-block-experience-time-interval["'][^>]*>([\s\S]*?)<\/div>/iu,
        ) ?? '';
      const desc =
        extractTagContent(
          itemHtml,
          /data-qa=["']resume-block-experience-description["'][^>]*>([\s\S]*?)<\/div>/iu,
        ) ?? '';

      if (position || company) {
        const isCurrent =
          interval.toLowerCase().includes('настоящее время') ||
          interval.toLowerCase().includes('present');
        experience.push({
          title: position || 'Специалист',
          employer: company || 'Компания',
          startDate: interval.split('—')[0]?.trim(),
          endDate: isCurrent ? undefined : interval.split('—')[1]?.trim(),
          current: isCurrent,
          responsibilities: desc ? [desc] : [],
          achievements: [],
        });
      }
    }
  }

  // Extract Education items
  const education: ParsedResumeEducation[] = [];
  const eduBlockMatch =
    /data-qa=["']resume-block-education["'][\s\S]*?<\/div>\s*<\/div>/iu.exec(html);
  const eduHtml = eduBlockMatch ? eduBlockMatch[0] : html;
  const eduItemRegex =
    /data-qa=["']resume-block-education-item["'][^>]*>([\s\S]*?)(?=<div[^>]*data-qa=["']resume-block-education-item|data-qa=["']resume-block-languages|$)/giu;
  let eduMatch: RegExpExecArray | null;
  while ((eduMatch = eduItemRegex.exec(eduHtml)) !== null) {
    const itemHtml = eduMatch[1];
    const inst =
      extractTagContent(
        itemHtml,
        /data-qa=["']resume-block-education-name["'][^>]*>([\s\S]*?)<\/div>/iu,
      ) ?? '';
    const qual =
      extractTagContent(
        itemHtml,
        /data-qa=["']resume-block-education-organization["'][^>]*>([\s\S]*?)<\/div>/iu,
      ) ?? '';
    if (inst || qual) {
      education.push({
        institution: inst || 'Высшее образование',
        qualification: qual || undefined,
      });
    }
  }

  // Extract Languages
  const languages: ParsedResumeLanguage[] = [];
  const langBlockMatch =
    /data-qa=["']resume-block-languages["'][^>]*>([\s\S]*?)(?=<div[^>]*data-qa=["']resume-block-|<div[^>]*class=["'][^"']*resume-block|<footer|$)/iu.exec(
      html,
    );
  if (langBlockMatch) {
    const langLines = langBlockMatch[1]
      .replace(/<[^>]+>/gu, '\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of langLines) {
      const parts = line.split('—').map((s) => s.trim());
      if (parts.length > 0 && parts[0]) {
        let cefr: CefrLevel | undefined;
        const upper = line.toUpperCase();
        if (upper.includes('C2')) cefr = 'C2';
        else if (upper.includes('C1')) cefr = 'C1';
        else if (upper.includes('B2')) cefr = 'B2';
        else if (upper.includes('B1')) cefr = 'B1';
        else if (upper.includes('A2')) cefr = 'A2';
        else if (upper.includes('A1')) cefr = 'A1';

        languages.push({
          name: parts[0],
          cefr,
        });
      }
    }
  }

  const rawText = [
    fullName,
    targetRole,
    about,
    skills.length ? `Навыки: ${skills.join(', ')}` : '',
    ...experience.map(
      (e) => `${e.title} в ${e.employer}\n${e.responsibilities.join('\n')}`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    fullName,
    targetRole,
    about,
    contact: {
      location:
        extractTagContent(
          html,
          /data-qa=["']resume-block-address["'][^>]*>([\s\S]*?)<\/div>/iu,
        ) ?? undefined,
      links: [sourceUrl],
    },
    experience,
    skills,
    education,
    courses: [],
    tests: [],
    recommendations: [],
    languages,
    rawText,
  };
}

/**
 * The candidate's own resume id, or nothing when this is not a resume link.
 *
 * An absolute link has to name hh.ru itself: a look-alike host serving
 * `/resume/<id>` must never be read as the candidate's resume.
 */
function resumeIdFromHref(href: string): string | undefined {
  try {
    const url = new URL(href, 'https://hh.ru');
    const host = url.hostname.toLowerCase();
    const ownHost =
      host === 'hh.ru' ||
      host.endsWith('.hh.ru') ||
      host === 'headhunter.ru' ||
      host.endsWith('.headhunter.ru');
    if (!ownHost) return undefined;
    return /^\/resume\/([A-Za-z0-9_-]+)\/?$/u.exec(url.pathname)?.[1];
  } catch {
    return undefined;
  }
}

export function parseHhResumesList(html: string): Array<{
  id: string;
  title: string;
  url: string;
  updatedLabel?: string;
}> {
  const resumes: Array<{
    id: string;
    title: string;
    url: string;
    updatedLabel?: string;
  }> = [];

  // The link is the contract, not the attribute name next to it.
  //
  // Gating on `data-qa` meant every hh.ru markup revision silently emptied the
  // candidate's resume list — the flow then reported "вход выполнен, но данные
  // получить не удалось" on a page that plainly showed their resumes
  // (B156, and again B157). A `/resume/<id>` link on the candidate's own
  // resume list, read inside their own signed-in session, already identifies a
  // resume; the caller has verified both the host and that the page really is
  // that list.
  const resumeLinkRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  let match: RegExpExecArray | null;
  while ((match = resumeLinkRegex.exec(html)) !== null) {
    const attributes = match[1];
    const href = /(?:^|\s)href=["']([^"']+)["']/iu.exec(attributes)?.[1];
    const resumeId = href ? resumeIdFromHref(href) : undefined;
    if (!resumeId) continue;
    const title = match[2]
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const existing = resumes.find((resume) => resume.id === resumeId);
    if (!existing) {
      resumes.push({
        id: resumeId,
        title: title || 'Резюме hh.ru',
        url: `https://hh.ru/resume/${resumeId}`,
        updatedLabel: 'Готово к импорту',
      });
      continue;
    }
    // One card links the same resume more than once — from its title and from
    // an icon with no text. Keep the label a human can recognise.
    if (title.length > existing.title.length || existing.title === 'Резюме hh.ru') {
      if (title) existing.title = title;
    }
  }

  return resumes;
}
