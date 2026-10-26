import type { DatabaseSync } from 'node:sqlite';
import type { RecruiterChannel, RecruiterChannelStatus } from '../../../shared/recruiterChannel';
import { rankChannels } from '../../../shared/recruiterChannel';
import type { EmailStatus, RecruiterContact } from '../../../shared/recruiterContact';
import type { DossierDeps } from './collectRecruiterDossier';
import { collectRecruiterDossier } from './collectRecruiterDossier';
import { extractChannels } from './extractChannels';

/** Повторный сбор по тому же человеку в компании — не чаще раза в 30 дней. */
export const DOSSIER_CACHE_DAYS = 30;

const CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS recruiter_dossier_cache (
  person_key TEXT PRIMARY KEY,
  channels TEXT NOT NULL,
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

export interface DossierServiceOptions extends DossierDeps {
  readonly database: DatabaseSync;
}

/** Досье только на конкретного человека: «Команда найма» без имени не ищется. */
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
  return { ...contact, channels: rankChannels([...known, ...found]) };
}
