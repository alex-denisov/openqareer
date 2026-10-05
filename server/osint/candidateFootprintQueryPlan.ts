import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { FootprintAdapterId } from '../../shared/candidateFootprint';
import type { ResumeDraft } from '../domain/resumeDraft';
import { MAIGRET_SITES } from './adapters/maigretSiteCatalogue';

export type { FootprintAdapterId } from '../../shared/candidateFootprint';
export type FootprintQueryKind = 'username' | 'email' | 'profile_url' | 'name' | 'work_context';

export type FootprintQueryInput =
  | { readonly username: string }
  | { readonly email: string }
  | { readonly profileUrl: string }
  | { readonly mode: 'people'; readonly fullName: string; readonly photoUrl?: string }
  | {
      readonly mode: 'context';
      readonly fullName: string;
      readonly employers: readonly string[];
      readonly city?: string;
      readonly photoUrl?: string;
    };

export interface FootprintQueryPlanItem {
  readonly id: string;
  readonly adapterId: FootprintAdapterId;
  readonly kind: FootprintQueryKind;
  readonly preview: string;
  readonly selectedByDefault: true;
  readonly input: FootprintQueryInput;
}

export interface PublicFootprintQueryPlanItem {
  readonly id: string;
  readonly adapterId: FootprintAdapterId;
  readonly kind: FootprintQueryKind;
  readonly preview: string;
  readonly selectedByDefault: boolean;
  readonly available: boolean;
}

function itemId(adapterId: FootprintAdapterId, kind: FootprintQueryKind, identity: string): string {
  return createHash('sha256')
    .update(`${adapterId}\0${kind}\0${identity.normalize('NFKC').toLowerCase()}`)
    .digest('hex')
    .slice(0, 20);
}

function maskedEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function profileUrl(value: string | undefined): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const candidateUrl = /^https?:\/\//iu.test(value) ? value : `https://${value}`;
    const url = new URL(candidateUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) || isIP(url.hostname) !== 0 ||
      !url.hostname.includes('.') || url.username || url.password ||
      url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.internal') ||
      (url.port && !['80', '443'].includes(url.port))
    ) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function usernameFromProfileUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./u, '');
  const parts = url.pathname.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return ''; }
  });
  let value: string | undefined;
  if (['linkedin.com'].includes(host) && parts[0]?.toLowerCase() === 'in') value = parts[1];
  else if (['t.me', 'telegram.me'].includes(host)) value = parts[0];
  else if (['github.com', 'gitlab.com', 'dev.to'].includes(host)) value = parts[0];
  else if (host === 'medium.com') value = parts[0]?.replace(/^@/u, '');
  else value = usernameFromMaigretTemplate(raw, host) ?? undefined;
  return value && /^[A-Za-z0-9._-]{1,64}$/u.test(value) ? value : null;
}

function usernameFromMaigretTemplate(raw: string, host: string): string | null {
  for (const site of MAIGRET_SITES) {
    let template: URL;
    try { template = new URL(site.url.replace('{username}', '__oq_username__')); } catch { continue; }
    if (template.hostname.toLowerCase() !== host) continue;
    const marker = '__oq_username__';
    const markerIndex = template.pathname.indexOf(marker);
    if (markerIndex < 0) continue;
    const prefix = template.pathname.slice(0, markerIndex);
    const suffix = template.pathname.slice(markerIndex + marker.length);
    let pathname: string;
    try { pathname = new URL(raw).pathname; } catch { continue; }
    if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) continue;
    const end = pathname.length - suffix.length;
    const value = pathname.slice(prefix.length, end);
    if (value && !value.includes('/')) return value;
  }
  return null;
}

function addItem(
  list: FootprintQueryPlanItem[],
  adapterId: FootprintAdapterId,
  kind: FootprintQueryKind,
  preview: string,
  identity: string,
  input: FootprintQueryInput,
): void {
  const id = itemId(adapterId, kind, identity);
  if (list.some((item) => item.id === id)) return;
  list.push({ id, adapterId, kind, preview, selectedByDefault: true, input });
}

function addUsernameItems(list: FootprintQueryPlanItem[], usernames: readonly string[]): void {
  for (const username of usernames) {
    const preview = `Проверить открытые профили под ником «${username}»`;
    for (const adapterId of ['sherlock', 'maigret'] as const) {
      addItem(list, adapterId, 'username', preview, username, { username });
    }
  }
}

function addIdentityItems(list: FootprintQueryPlanItem[], draft: ResumeDraft): void {
  const fullName = draft.candidate.fullName?.trim().replace(/\s+/gu, ' ').slice(0, 160) ?? '';
  const photoUrl = profileUrl(draft.candidate.photoUrl) ?? undefined;
  const email = draft.candidate.contact?.email?.trim().toLowerCase() ?? '';
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    addItem(list, 'hibp', 'email', `Проверить почту ${maskedEmail(email)} через безопасный поиск HIBP`, email, { email });
  }
  if (!fullName) return;
  addItem(list, 'exa', 'name', `Искать открытые профили по имени «${fullName}»`,
    JSON.stringify([fullName, photoUrl]), {
    mode: 'people', fullName, ...(photoUrl ? { photoUrl } : {}),
  });
  const employers = [...new Set(draft.experience
    .map((item) => item.employer?.trim())
    .filter((item): item is string => Boolean(item)))]
    .slice(0, 10);
  const city = draft.candidate.contact?.location?.trim().slice(0, 120);
  for (const employer of employers) {
    addItem(
      list, 'exa', 'work_context', `Искать имя и работодателя «${employer}»`,
      JSON.stringify([fullName, photoUrl, 'employer', employer]),
      { mode: 'context', fullName, employers: [employer], ...(photoUrl ? { photoUrl } : {}) },
    );
  }
  if (city) {
    addItem(
      list, 'exa', 'work_context', `Искать имя и город «${city}»`,
      JSON.stringify([fullName, photoUrl, 'city', city]),
      { mode: 'context', fullName, employers: [], city, ...(photoUrl ? { photoUrl } : {}) },
    );
  }
}

export function buildCandidateFootprintQueryPlan(draft: ResumeDraft): readonly FootprintQueryPlanItem[] {
  const links = [
    ...(draft.candidate.contact?.links ?? []),
    draft.candidate.contact?.linkedinUrl,
  ].map(profileUrl).filter((value): value is string => value !== null);
  const usernames = [...new Set([
    ...links.map(usernameFromProfileUrl).filter((value): value is string => value !== null),
    usernameFromTelegram(draft.candidate.contact?.telegram),
  ].filter((value): value is string => Boolean(value)))];
  const plan: FootprintQueryPlanItem[] = [];
  addUsernameItems(plan, usernames);
  addIdentityItems(plan, draft);
  for (const link of [...new Set(links)]) {
    addItem(plan, 'wayback', 'profile_url', `Проверить архив публичной страницы ${link}`, link, { profileUrl: link });
  }
  return plan;
}

function usernameFromTelegram(value: string | undefined): string | null {
  if (!value) return null;
  if (/^@[A-Za-z0-9_]{3,64}$/u.test(value.trim())) return value.trim().slice(1);
  const normalized = profileUrl(value.trim());
  return normalized ? usernameFromProfileUrl(normalized) : null;
}

export function toPublicFootprintQueryPlan(
  plan: readonly FootprintQueryPlanItem[],
  availability: Partial<Record<FootprintAdapterId, boolean>> = {},
): readonly PublicFootprintQueryPlanItem[] {
  return plan.map(({ id, adapterId, kind, preview, selectedByDefault }) => {
    const available = availability[adapterId] ?? true;
    return { id, adapterId, kind, preview, selectedByDefault: selectedByDefault && available, available };
  });
}
