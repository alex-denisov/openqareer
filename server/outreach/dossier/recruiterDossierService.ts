import type { DatabaseSync } from 'node:sqlite';
import type { RecruiterChannel, RecruiterChannelStatus } from '../../../shared/recruiterChannel';
import { rankChannels } from '../../../shared/recruiterChannel';
import type { EmailStatus, RecruiterContact } from '../../../shared/recruiterContact';
import type { DossierDeps } from './collectRecruiterDossier';
import { collectRecruiterDossier, namesPerson } from './collectRecruiterDossier';
import type { CompanyPagesResult } from './companyPages';
import { collectCompanyPages } from './companyPages';
import { applyEmailFormat, formatsOf } from './emailFormat';
import { extractChannels } from './extractChannels';

/** Повторный сбор по тому же человеку в компании — не чаще раза в 30 дней. */
export const DOSSIER_CACHE_DAYS = 30;
const RETRY_AFTER_FAILURE_MS = 6 * 3_600_000;

const CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS recruiter_dossier_cache (
  person_key TEXT PRIMARY KEY,
  channels TEXT NOT NULL,
  collected_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS company_email_format_cache (
  domain TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  collected_at TEXT NOT NULL
) STRICT;`;

const EMAIL_STATUS: Record<EmailStatus, RecruiterChannelStatus> = {
  verified: 'verified',
  hypothesis: 'hypothesis',
  unverified: 'published',
};

/** Каналы, уже известные из вакансии и поиска рекрутёра. */
export function contactChannels(contact: RecruiterContact, companyDomain?: string): RecruiterChannel[] {
  const observedAt = contact.updatedAt;
  const sourceUrl = contact.sourceReceipt?.sourceUrl ?? null;
  const text = [contact.telegram, contact.whatsapp, contact.phone, contact.linkedinUrl, contact.githubUrl, contact.twitterUrl]
    .filter(Boolean)
    .join('\n');
  const channels = extractChannels(text, { companyDomain, sourceUrl, observedAt });
  if (contact.telegram && !channels.some((c) => c.kind === 'telegram') && contact.telegram.startsWith('@')) {
    const nick = contact.telegram.slice(1);
    channels.push({ kind: 'telegram', value: contact.telegram, href: `https://t.me/${nick}`, status: 'published', sourceUrl, observedAt });
  }
  if (contact.email) {
    // Адрес из поиска рекрутёра выведен на домене компании: рабочий, если не бесплатная служба.
    const domain = contact.email.split('@')[1]?.toLowerCase();
    const [email] = extractChannels(contact.email, { companyDomain: companyDomain ?? domain, sourceUrl, observedAt });
    if (email) channels.push({ ...email, status: EMAIL_STATUS[contact.emailStatus] });
  }
  return channels;
}

function personKey(contact: RecruiterContact): string {
  return `${contact.fullName.trim().toLowerCase()}|${contact.companyName.trim().toLowerCase()}`;
}

function cached(database: DatabaseSync, key: string, now: Date): RecruiterChannel[] | null {
  database.exec(CACHE_SCHEMA);
  const row = database
    .prepare('SELECT channels, collected_at FROM recruiter_dossier_cache WHERE person_key = ?')
    .get(key) as { channels: string; collected_at: string } | undefined;
  if (!row || Date.parse(row.collected_at) <= now.getTime() - DOSSIER_CACHE_DAYS * 86_400_000) return null;
  return JSON.parse(row.channels) as RecruiterChannel[];
}

function remember(database: DatabaseSync, key: string, channels: readonly RecruiterChannel[], now: Date): void {
  database
    .prepare('DELETE FROM recruiter_dossier_cache WHERE collected_at <= ?')
    .run(new Date(now.getTime() - DOSSIER_CACHE_DAYS * 86_400_000).toISOString());
  database
    .prepare(
      `INSERT INTO recruiter_dossier_cache (person_key, channels, collected_at) VALUES (?, ?, ?)
       ON CONFLICT(person_key) DO UPDATE SET channels = excluded.channels, collected_at = excluded.collected_at`,
    )
    .run(key, JSON.stringify(channels), now.toISOString());
}

function cachedCompany(database: DatabaseSync, domain: string, now: Date): CompanyPagesResult | null {
  database.exec(CACHE_SCHEMA);
  const row = database
    .prepare('SELECT result, collected_at FROM company_email_format_cache WHERE domain = ?')
    .get(domain) as { result: string; collected_at: string } | undefined;
  if (!row || Date.parse(row.collected_at) <= now.getTime() - DOSSIER_CACHE_DAYS * 86_400_000) return null;
  return JSON.parse(row.result) as CompanyPagesResult;
}

async function companyPages(domain: string, options: DossierServiceOptions, now: Date): Promise<CompanyPagesResult> {
  const known = cachedCompany(options.database, domain, now);
  if (known) return known;
  const result = await collectCompanyPages(domain, options);
  // Неполный сбор (отказ сайта) кэшируется на 6 часов, чтобы не повторять запросы на каждого человека.
  const collectedAt = result.complete ? now : new Date(now.getTime() - DOSSIER_CACHE_DAYS * 86_400_000 + RETRY_AFTER_FAILURE_MS);
  options.database
    .prepare('DELETE FROM company_email_format_cache WHERE collected_at <= ?')
    .run(new Date(now.getTime() - DOSSIER_CACHE_DAYS * 86_400_000).toISOString());
  options.database
    .prepare(
      `INSERT INTO company_email_format_cache (domain, result, collected_at) VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET result = excluded.result, collected_at = excluded.collected_at`,
    )
    .run(domain, JSON.stringify(result), collectedAt.toISOString());
  return result;
}

function sameName(a: string, b: string): boolean {
  const fold = (value: string) => value.trim().toLowerCase().split(/\s+/u).sort().join(' ');
  return fold(a) === fold(b);
}

const AFTER_NAME_CHARS = 160;
const NEXT_PERSON = /\p{Lu}\p{Ll}+[ \t\u00a0]+\p{Lu}\p{Ll}+/u;

/**
 * Текст сразу после имени до следующего человека: на странице контактов
 * телефон стоит под именем, а соседний — уже чужой.
 */
function afterName(text: string, fullName: string): string {
  const surname = fullName.trim().split(/\s+/u).at(-1) ?? '';
  const index = surname.length > 1 ? text.indexOf(surname) : -1;
  if (index < 0) return '';
  const tail = text.slice(index + surname.length, index + surname.length + AFTER_NAME_CHARS);
  const next = NEXT_PERSON.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

/**
 * Рабочая почта по страницам компании: опубликованный адрес человека, иначе
 * формула по чужим опубликованным адресам. Формула заменяет общий шаблон-догадку.
 */
export function companyEmailChannels(
  contact: RecruiterContact,
  domain: string,
  pages: CompanyPagesResult,
  observedAt: string,
): { channels: RecruiterChannel[]; replacesGuess: boolean } {
  const direct = (pages.snippets ?? [])
    .filter((snippet) => namesPerson(snippet.text, contact.fullName))
    .flatMap((snippet) =>
      extractChannels(afterName(snippet.text, contact.fullName), { companyDomain: domain, sourceUrl: snippet.sourceUrl, observedAt })
        .filter((channel) => !channel.kind.startsWith('email_')),
    );
  const own = pages.samples.find((sample) => sameName(sample.fullName, contact.fullName));
  if (own) {
    return {
      channels: [...direct, { kind: 'email_corporate', value: own.email, href: `mailto:${own.email}`, status: 'published', sourceUrl: own.sourceUrl, observedAt }],
      replacesGuess: true,
    };
  }
  if (!pages.format) return { channels: direct, replacesGuess: false };
  const email = applyEmailFormat(pages.format.id, contact.fullName, domain);
  if (!email || !formatsOf({ fullName: contact.fullName, email }).includes(pages.format.id)) return { channels: direct, replacesGuess: false };
  return {
    channels: [...direct, { kind: 'email_corporate', value: email, href: `mailto:${email}`, status: 'hypothesis', sourceUrl: pages.format.sourceUrl, observedAt }],
    replacesGuess: true,
  };
}

export interface DossierServiceOptions extends DossierDeps {
  readonly database: DatabaseSync;
}

/** Сбор каналов только на конкретного человека: «Команда найма» без имени не ищется. */
export async function withDossier(
  contact: RecruiterContact,
  companyDomain: string | undefined,
  options: DossierServiceOptions,
): Promise<RecruiterContact> {
  const known = contactChannels(contact, companyDomain);
  const named = contact.fullName.trim().split(/\s+/u).length >= 2 && contact.fullName !== 'Команда найма';
  if (!named) return { ...contact, channels: rankChannels(known) };
  const now = options.now?.() ?? new Date();
  const key = personKey(contact);
  let found = cached(options.database, key, now);
  if (!found) {
    const result = await collectRecruiterDossier(
      { fullName: contact.fullName, companyName: contact.companyName, ...(companyDomain ? { companyDomain } : {}) },
      options,
    );
    found = result.channels;
    // Ошибка источника — не «ничего нет»: неполный сбор повторится при следующем поиске.
    if (result.complete) remember(options.database, key, found, now);
  }
  let channels = [...known, ...found];
  if (companyDomain) {
    const company = companyEmailChannels(contact, companyDomain, await companyPages(companyDomain, options, now), now.toISOString());
    if (company.replacesGuess) {
      // Догадка «имя.фамилия» уступает формуле, подтверждённой адресами самой компании.
      channels = channels.filter((channel) => !(channel.kind === 'email_corporate' && channel.status === 'hypothesis'));
    }
    channels = [...channels, ...company.channels];
  }
  // Опубликованный или подтверждённый рабочий адрес делает догадку лишней.
  if (channels.some((channel) => channel.kind === 'email_corporate' && channel.status !== 'hypothesis')) {
    channels = channels.filter((channel) => !(channel.kind === 'email_corporate' && channel.status === 'hypothesis'));
  }
  return { ...contact, channels: rankChannels(channels) };
}
