import type {
  ParsedResume,
  ParsedResumeEducation,
  ParsedResumeExperience,
  ParsedResumeLanguage,
} from '../../features/workspace/resumeParser';
import type { CefrLevel } from '../../features/resume/resumeTypes';
import { extractAllTagContents, extractTagContent, plainText } from './hhMarkup';

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

  // hh.ru's Magritte profile renders every skill as `skill-tag-<id>` grouped
  // under a level heading; the old `bloko-tag__text` / `skills-element` hooks
  // are gone from that surface but still serve the legacy resume view.
  const skills = [
    ...extractAllTagContents(
      html,
      /data-qa=["'](?:bloko-tag__text|skills-element)["'][^>]*>([\s\S]*?)<\/span>/iu,
    ),
    ...extractAllTagContents(
      html,
      /data-qa=["']skill-tag-[A-Za-z0-9_-]+["'][^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/iu,
    ),
  ].filter((skill, index, all) => all.indexOf(skill) === index);

  const salary =
    extractTagContent(
      html,
      /data-qa=["']resume-block-salary["'][^>]*>([\s\S]*?)<\/div>/iu,
    ) ?? undefined;

  // «Тип занятости: Постоянная работа», «Формат работы: …» and the rest of the
  // position card. They are conditions the candidate stated, not decoration.
  const positionTerms = extractAllTagContents(
    html,
    /data-qa=["']resume-position-field-[A-Za-z0-9_-]+["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/iu,
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

  // The Magritte profile states education as its own cards
  // (`resume-list-card-education-item-<field>`), label first, value last.
  const educationCardRegex =
    /data-qa=["']resume-list-card-education-item-[A-Za-z0-9_-]+["'][^>]*>([\s\S]*?)(?=<div[^>]*data-qa=["']resume-list-card-education-item|<div[^>]*class=["'][^"']*magritte-border-element|$)/giu;
  let educationMatch: RegExpExecArray | null;
  while ((educationMatch = educationCardRegex.exec(html)) !== null) {
    const value = educationValue(educationMatch[1]);
    if (value && !education.some((item) => item.institution === value)) {
      education.push({ institution: value });
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

  const contact = {
    email:
      extractTagContent(
        html,
        /data-qa=["']resume-contact-email-value-text["'][^>]*>([\s\S]*?)<\/span>/iu,
      ) ?? undefined,
    phone:
      extractTagContent(
        html,
        /data-qa=["']resume-contact-phone-value-preferred-text["'][^>]*>([\s\S]*?)<\/span>/iu,
      ) ?? undefined,
    location:
      extractTagContent(
        html,
        /data-qa=["']resume-block-address["'][^>]*>([\s\S]*?)<\/div>/iu,
      ) ?? undefined,
    links: [sourceUrl],
  };

  /**
   * `rawText` is the entire message to the candidate API: the server re-reads
   * it and stores what it finds. Everything the parser found and leaves out
   * here is a fact the profile never receives, and a thin enough `rawText` is
   * refused outright as `resume_without_facts` (owner report, 2026-08-26).
   */
  const rawText = [
    fullName,
    targetRole,
    about,
    salary && salary !== about ? salary : '',
    positionTerms.join('\n'),
    contact.location,
    contact.email,
    contact.phone,
    skills.length ? `Навыки: ${skills.join(', ')}` : '',
    ...experience.map(
      (e) => `${e.title} в ${e.employer}\n${e.responsibilities.join('\n')}`,
    ),
    education.length
      ? `Образование: ${education
          .map((item) => [item.institution, item.qualification].filter(Boolean).join(', '))
          .join('; ')}`
      : '',
    languages.length
      ? `Языки: ${languages
          .map((item) => [item.name, item.cefr].filter(Boolean).join(' '))
          .join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    fullName,
    targetRole,
    about: about ?? salary,
    contact,
    experience,
    skills,
    education,
    courses: [],
    tests: [],
    recommendations: [],
    languages,
    additional: positionTerms.length
      ? { workSchedule: positionTerms.join('; ') }
      : undefined,
    rawText,
  };
}

/**
 * The value of one education card. hh.ru renders the card as a labelled cell —
 * «Уровень», then «Среднее» — so the last cell is the answer and the first is
 * the question. Storing «Уровень Среднее» as an institution would be the kind
 * of not-quite-true display the design contract forbids.
 */
function educationValue(cardHtml: string): string | undefined {
  const cells = extractAllTagContents(
    cardHtml,
    /data-qa=["']cell-text-content["'][^>]*>([\s\S]*?)<\/div>/iu,
  );
  const text = cells.length > 0 ? cells[cells.length - 1] : plainText(cardHtml);
  return text || undefined;
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

/**
 * The label on one resume card. hh.ru puts the update stamp inside the same
 * link as the name and writes `&nbsp;` through it, so the raw link text reads
 * «Менеджер по продукту Обновлено 9&nbsp;августа&nbsp;2026&nbsp;в&nbsp;16:09»
 * — which is what the candidate saw in the picker (owner report, 2026-08-26).
 */
function resumeCardTitle(linkHtml: string): string {
  const text = plainText(linkHtml);
  const name = text.split(/\s+Обновлено\s+/u)[0].trim();
  return name || text;
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
    const title = resumeCardTitle(match[2]);
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
