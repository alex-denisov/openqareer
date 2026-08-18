import type { ProfileUrlImportResult } from './profileUrlImport';
import type {
  ParsedResume,
  ParsedResumeEducation,
  ParsedResumeExperience,
  ParsedResumeLanguage,
} from '../../src/features/workspace/resumeParser';
import type { CefrLevel } from '../../src/features/resume/resumeTypes';

function extractTagContent(html: string, tagAttrPattern: RegExp): string | null {
  const match = tagAttrPattern.exec(html);
  if (!match) return null;
  const content = match[1] ?? match[2] ?? '';
  return content.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim() || null;
}

function extractAllTagContents(html: string, tagAttrPattern: RegExp): string[] {
  const results: string[] = [];
  const regex = new RegExp(tagAttrPattern.source, tagAttrPattern.flags.includes('g') ? tagAttrPattern.flags : `${tagAttrPattern.flags}g`);
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

// eslint-disable-next-line max-lines-per-function
export function parseHhResumeHtml(html: string, sourceUrl: string): ParsedResume {
  const fullName =
    extractTagContent(html, /data-qa=["']resume-personal-name["'][^>]*>([\s\S]*?)<\/(?:div|span|h\d)>/iu) ??
    extractTagContent(html, /<h1[^>]*class=["'][^"']*resume-header[^"']*["'][^>]*>([\s\S]*?)<\/h1>/iu) ??
    undefined;

  const targetRole =
    extractTagContent(html, /data-qa=["']resume-block-title-position["'][^>]*>([\s\S]*?)<\/(?:div|span|h\d)>/iu) ??
    extractTagContent(html, /data-qa=["']resume-title["'][^>]*>([\s\S]*?)<\/(?:div|span|h\d)>/iu) ??
    undefined;

  const about =
    extractTagContent(html, /data-qa=["']resume-block-about["'][^>]*>([\s\S]*?)<\/div>/iu) ??
    extractTagContent(html, /data-qa=["']resume-block-skills-content["'][^>]*>([\s\S]*?)<\/div>/iu) ??
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
      const position = extractTagContent(itemHtml, /data-qa=["']resume-block-experience-position["'][^>]*>([\s\S]*?)<\/div>/iu) ?? '';
      const company = extractTagContent(itemHtml, /data-qa=["']resume-block-experience-company["'][^>]*>([\s\S]*?)<\/div>/iu) ?? '';
      const interval = extractTagContent(itemHtml, /data-qa=["']resume-block-experience-time-interval["'][^>]*>([\s\S]*?)<\/div>/iu) ?? '';
      const desc = extractTagContent(itemHtml, /data-qa=["']resume-block-experience-description["'][^>]*>([\s\S]*?)<\/div>/iu) ?? '';

      if (position || company) {
        const isCurrent = interval.toLowerCase().includes('настоящее время') || interval.toLowerCase().includes('present');
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
  const eduBlockMatch = /data-qa=["']resume-block-education["'][\s\S]*?<\/div>\s*<\/div>/iu.exec(html);
  const eduHtml = eduBlockMatch ? eduBlockMatch[0] : html;
  const eduItemRegex = /data-qa=["']resume-block-education-item["'][^>]*>([\s\S]*?)(?=<div[^>]*data-qa=["']resume-block-education-item|data-qa=["']resume-block-languages|$)/giu;
  let eduMatch: RegExpExecArray | null;
  while ((eduMatch = eduItemRegex.exec(eduHtml)) !== null) {
    const itemHtml = eduMatch[1];
    const inst = extractTagContent(itemHtml, /data-qa=["']resume-block-education-name["'][^>]*>([\s\S]*?)<\/div>/iu) ?? '';
    const qual = extractTagContent(itemHtml, /data-qa=["']resume-block-education-organization["'][^>]*>([\s\S]*?)<\/div>/iu) ?? '';
    if (inst || qual) {
      education.push({
        institution: inst || 'Высшее образование',
        qualification: qual || undefined,
      });
    }
  }

  // Extract Languages
  const languages: ParsedResumeLanguage[] = [];
  const langBlockMatch = /data-qa=["']resume-block-languages["'][^>]*>([\s\S]*?)<\/div>/iu.exec(html);
  if (langBlockMatch) {
    const langLines = langBlockMatch[1].replace(/<[^>]+>/gu, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
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
    ...experience.map((e) => `${e.title} в ${e.employer}\n${e.responsibilities.join('\n')}`),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    fullName,
    targetRole,
    about,
    contact: {
      location: extractTagContent(html, /data-qa=["']resume-block-address["'][^>]*>([\s\S]*?)<\/div>/iu) ?? undefined,
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

// eslint-disable-next-line max-lines-per-function
export async function parseHhResumeFromUrl(
  url: string,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => string;
  } = {},
): Promise<ProfileUrlImportResult> {
  const fetcher = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());

  try {
    const response = await fetcher(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      return {
        status: 'unavailable',
        platform: 'hh',
        sourceUrl: url,
        reason: response.status === 403 ? 'authwall' : 'network',
        nextAction: 'upload_export_or_pdf',
      };
    }

    const html = await response.text();
    const parsed = parseHhResumeHtml(html, url);

    const facts: Array<{
      kind: 'headline' | 'summary';
      value: string;
      sourceLocator: string;
      confidence: 'public-metadata';
    }> = [];

    if (parsed.targetRole) {
      facts.push({
        kind: 'headline',
        value: parsed.targetRole,
        sourceLocator: `${url}#headline`,
        confidence: 'public-metadata',
      });
    }

    if (parsed.about) {
      facts.push({
        kind: 'summary',
        value: parsed.about,
        sourceLocator: `${url}#about`,
        confidence: 'public-metadata',
      });
    } else if (parsed.experience.length > 0) {
      const topExp = parsed.experience[0];
      facts.push({
        kind: 'summary',
        value: `${topExp.title} в ${topExp.employer}. Ключевые навыки: ${parsed.skills.slice(0, 5).join(', ')}`,
        sourceLocator: `${url}#top-experience`,
        confidence: 'public-metadata',
      });
    }

    return {
      status: 'imported',
      platform: 'hh',
      sourceUrl: url,
      capturedAt: now(),
      accessPath: 'permitted_public_page',
      facts,
      parsedResume: parsed,
    };
  } catch {
    return {
      status: 'unavailable',
      platform: 'hh',
      sourceUrl: url,
      reason: 'network',
      nextAction: 'upload_export_or_pdf',
    };
  }
}
