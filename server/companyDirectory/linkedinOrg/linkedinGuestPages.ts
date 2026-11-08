/**
 * B621: разбор гостевых страниц LinkedIn и сайта компании для поиска
 * organization ID (f_C). Только чистые функции над HTML, без сети.
 *
 * Связка доказательств:
 * 1. Официальный сайт компании ссылается на `linkedin.com/company/<slug>` —
 *    страница принадлежит владельцу домена (одно совпадение названия запрещено).
 * 2. Гостевая карточка вакансии `/jobs/view/<id>` содержит
 *    `<meta name="companyId">` и ссылку на `/company/<slug>` той же компании —
 *    ID и slug связаны самим LinkedIn на одной странице.
 */

export interface SearchCard {
  readonly jobId: string;
  readonly companySlug: string;
}

export interface JobViewCompany {
  readonly companyId: string;
  readonly companySlug: string;
}

export type BlockKind = 'rate_limited' | 'challenge';

const COMPANY_LINK =
  /(?:https?:)?\\?\/\\?\/(?:[a-z]{2,3}\.|www\.)?linkedin\.com\\?\/company\\?\/([^/?#"'\s<>&\\]+)/gi;

/** Нормализованный slug: нижний регистр, без процентного кодирования. */
export function normalizeSlug(raw: string): string | null {
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  value = value.toLowerCase().replace(/\/+$/, '');
  if (!value || value.length > 120 || /[\s/]/.test(value)) return null;
  return value;
}

/** slug из сохранённой в реестре ссылки `linkedin.com/company/<slug>/...`. */
export function slugFromLinkedinUrl(url: string | null): string | null {
  if (!url) return null;
  COMPANY_LINK.lastIndex = 0;
  const match = COMPANY_LINK.exec(url);
  COMPANY_LINK.lastIndex = 0;
  return match ? normalizeSlug(match[1]!) : null;
}

/** Все различные slug компании, на которые ссылается страница сайта. */
export function companySlugsInHtml(html: string): readonly string[] {
  const slugs = new Set<string>();
  for (const match of html.matchAll(COMPANY_LINK)) {
    const slug = normalizeSlug(match[1]!);
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

/** Карточки ответа `jobs-guest/jobs/api/seeMoreJobPostings/search`. */
export function parseSearchCards(html: string): readonly SearchCard[] {
  const cards: SearchCard[] = [];
  const parts = html.split(/<li[\s>]/i).slice(1);
  for (const part of parts) {
    const job = /urn:li:jobPosting:(\d+)/.exec(part);
    if (!job) continue;
    COMPANY_LINK.lastIndex = 0;
    const company = COMPANY_LINK.exec(part);
    COMPANY_LINK.lastIndex = 0;
    const slug = company ? normalizeSlug(company[1]!) : null;
    if (slug) cards.push({ jobId: job[1]!, companySlug: slug });
  }
  return cards;
}

/** ID и slug работодателя из гостевой страницы `/jobs/view/<id>`. */
export function parseJobViewCompany(html: string): JobViewCompany | null {
  const id =
    /<meta[^>]*name="companyId"[^>]*content="(\d+)"/i.exec(html) ??
    /<meta[^>]*content="(\d+)"[^>]*name="companyId"/i.exec(html);
  if (!id) return null;
  const topcard = /topcard__org-name-link[^>]*href="([^"]+)"/i.exec(html);
  const slug = topcard ? slugFromLinkedinUrl(topcard[1]!) : null;
  if (!slug) return null;
  return { companyId: id[1]!, companySlug: slug };
}

/**
 * Ответ, после которого LinkedIn-запросы надо остановить на паузу:
 * 429/999 — ограничение частоты; Cloudflare или reCAPTCHA — проверка
 * браузера. Проверки не обходим, только ждём.
 */
export function detectBlock(status: number, body: string): BlockKind | null {
  if (status === 429 || status === 999) return 'rate_limited';
  if (/<title>\s*(?:Attention Required! \| Cloudflare|Checking your browser)/i.test(body)) {
    return 'challenge';
  }
  return null;
}

export interface CompanyCandidate {
  readonly id: string;
  readonly displayName: string;
}

/** Ответ `jobs-guest/api/typeaheadHits?typeaheadType=COMPANY`: только кандидаты, не доказательство. */
export function parseCompanyTypeahead(body: string): readonly CompanyCandidate[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, type, displayName } = item as Record<string, unknown>;
    return type === 'COMPANY' &&
      typeof id === 'string' &&
      /^\d+$/.test(id) &&
      typeof displayName === 'string'
      ? [{ id, displayName }]
      : [];
  });
}
