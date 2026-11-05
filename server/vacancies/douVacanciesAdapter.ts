import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { calculateVacancyFingerprint } from './vacancyFingerprint';

export interface DouVacancyRaw {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly location?: string;
  readonly salaryText?: string;
  readonly description?: string;
}

/**
 * Extracts raw vacancy items from DOU company vacancies HTML markup.
 * Matches `<li class="l-vacancy">` blocks.
 */
export function extractDouVacanciesFromHtml(html: string): DouVacancyRaw[] {
  const items: DouVacancyRaw[] = [];
  // Match each <li class="l-vacancy" ...> ... </li> block
  const vacancyBlockRegex = /<li[^>]*class=["'][^"']*l-vacancy[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;

  while ((match = vacancyBlockRegex.exec(html)) !== null) {
    const block = match[1];

    // Extract title & link from <a class="vt" href="...">Title</a>
    const linkMatch = /<a[^>]*class=["'][^"']*vt[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!linkMatch) continue;

    const rawUrl = linkMatch[1].trim();
    const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    if (!title || !rawUrl) continue;

    // Extract ID from URL: e.g. https://jobs.dou.ua/companies/stepico-games/vacancies/377660/
    const idMatch = /\/vacancies\/(\d+)/.exec(rawUrl);
    const id = idMatch ? idMatch[1] : rawUrl;

    // Extract location from <span class="cities">...</span>
    const cityMatch = /<span[^>]*class=["'][^"']*cities[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const location = cityMatch ? cityMatch[1].replace(/<[^>]+>/g, '').trim() : undefined;

    // Extract salary from <span class="salary">...</span>
    const salaryMatch = /<span[^>]*class=["'][^"']*salary[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const salaryText = salaryMatch ? salaryMatch[1].replace(/<[^>]+>/g, '').trim() : undefined;

    // Extract short description from <div class="sh-desc">...</div>
    const descMatch = /<div[^>]*class=["'][^"']*sh-desc[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : undefined;

    items.push({
      id,
      title,
      url: rawUrl.split('?')[0],
      location,
      salaryText,
      description,
    });
  }

  return items;
}

/**
 * Parses DOU company HTML into UnifiedVacancy records.
 */
export function parseDouCompanyVacanciesHtml(
  html: string,
  options: {
    company: string;
    companySlug: string;
    sourceUrl: string;
    observedAt?: string;
  },
): UnifiedVacancy[] {
  const rawVacancies = extractDouVacanciesFromHtml(html);
  const observedAt = options.observedAt ?? new Date().toISOString().slice(0, 10);
  const sourceId = `dou-${options.companySlug}`;

  return rawVacancies.map((v) => {
    const isRemote = v.location ? /remote|віддалено|удаленно/i.test(v.location) : false;
    const fingerprint = calculateVacancyFingerprint({
      title: v.title,
      company: options.company,
      description: v.description ?? v.title,
      location: v.location,
    });

    return {
      id: `${sourceId}-${v.id}`,
      fingerprint,
      title: v.title,
      company: options.company,
      status: 'active',
      location: v.location,
      isRemote,
      description: v.description ?? v.title,
      requiredSkills: [],
      url: v.url,
      publishedAt: observedAt,
      provenance: {
        sourceType: 'career_site',
        sourceId,
        sourceName: `DOU (${options.company})`,
        sourceUrl: options.sourceUrl,
        externalId: v.id,
        observedAt,
      },
    };
  });
}
