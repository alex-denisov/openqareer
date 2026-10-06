import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { isNamedEmployer, partitionEmployers } from '../../shared/employerLabel';
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
      !['http:', 'https:'].includes(url.protocol) ||
      isIP(url.hostname) !== 0 ||
      !url.hostname.includes('.') ||
      url.username ||
      url.password ||
      url.hostname.endsWith('.local') ||
      url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.internal') ||
      (url.port && !['80', '443'].includes(url.port))
    )
      return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function normalizeLinkedin(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^https?:\/\//iu.test(trimmed)) return trimmed;
  if (
    /^(?:www\.)?[a-z0-9-]+\.linkedin\.com\//iu.test(trimmed) ||
    /^(?:www\.)?linkedin\.com\//iu.test(trimmed)
  ) {
    return `https://${trimmed}`;
  }
  if (/^in\/[A-Za-z0-9._-]+$/iu.test(trimmed)) return `https://www.linkedin.com/${trimmed}`;
  if (/^[A-Za-z0-9._-]{2,64}$/u.test(trimmed)) return `https://www.linkedin.com/in/${trimmed}`;
  return null;
}

function usernameFromProfileUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./u, '');
  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return '';
      }
    });
  let value: string | undefined;
  if (
    (host === 'linkedin.com' || host.endsWith('.linkedin.com')) &&
    (parts[0]?.toLowerCase() === 'in' || parts[0]?.toLowerCase() === 'pub')
  ) {
    value = parts[1];
  } else if (['t.me', 'telegram.me'].includes(host)) {
    value = parts[0];
  } else if (['github.com', 'gitlab.com', 'dev.to', 'x.com', 'twitter.com'].includes(host)) {
    value = parts[0];
  } else if (host === 'medium.com') {
    value = parts[0]?.replace(/^@/u, '');
  } else {
    value = usernameFromMaigretTemplate(raw, host) ?? undefined;
  }
  return value && /^[A-Za-z0-9._-]{1,64}$/u.test(value) ? value : null;
}

function usernameFromMaigretTemplate(raw: string, host: string): string | null {
  for (const site of MAIGRET_SITES) {
    let template: URL;
    try {
      template = new URL(site.url.replace('{username}', '__oq_username__'));
    } catch {
      continue;
    }
    if (template.hostname.toLowerCase() !== host) continue;
    const marker = '__oq_username__';
    const markerIndex = template.pathname.indexOf(marker);
    if (markerIndex < 0) continue;
    const prefix = template.pathname.slice(0, markerIndex);
    const suffix = template.pathname.slice(markerIndex + marker.length);
    let pathname: string;
    try {
      pathname = new URL(raw).pathname;
    } catch {
      continue;
    }
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

function addWorkContextItems(
  list: FootprintQueryPlanItem[],
  draft: ResumeDraft,
  fullName: string,
  photoUrl?: string,
  manualEmployers?: readonly string[],
): void {
  const rawEmployers = draft.experience
    .map((item) => item.employer?.trim())
    .filter((item): item is string => Boolean(item));
  const { validEmployers } = partitionEmployers(rawEmployers);
  const extra = (manualEmployers ?? []).map((m) => m.trim()).filter(isNamedEmployer);
  const employers = [...new Set([...validEmployers, ...extra])].slice(0, 10);
  const city = draft.candidate.contact?.location?.trim().slice(0, 120);
  for (const employer of employers) {
    addItem(
      list,
      'exa',
      'work_context',
      `Искать имя и работодателя «${employer}»`,
      JSON.stringify([fullName, photoUrl, 'employer', employer]),
      { mode: 'context', fullName, employers: [employer], ...(photoUrl ? { photoUrl } : {}) },
    );
  }
  if (city) {
    addItem(
      list,
      'exa',
      'work_context',
      `Искать имя и город «${city}»`,
      JSON.stringify([fullName, photoUrl, 'city', city]),
      { mode: 'context', fullName, employers: [], city, ...(photoUrl ? { photoUrl } : {}) },
    );
  }
}

function addIdentityItems(
  list: FootprintQueryPlanItem[],
  draft: ResumeDraft,
  hasUsernames: boolean,
  manualEmployers?: readonly string[],
): void {
  const fullName = draft.candidate.fullName?.trim().replace(/\s+/gu, ' ').slice(0, 160) ?? '';
  const photoUrl = profileUrl(draft.candidate.photoUrl) ?? undefined;
  const email = draft.candidate.contact?.email?.trim().toLowerCase() ?? '';
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    addItem(
      list,
      'hibp',
      'email',
      `Проверить утечки по почте ${maskedEmail(email)} (нужно согласие)`,
      email,
      { email },
    );
  } else if (fullName || hasUsernames || draft.experience.length > 0) {
    addItem(list, 'hibp', 'email', 'Проверить утечки по почте (нужно согласие)', 'email:none', {
      email: '',
    });
  }
  if (!fullName) return;
  addItem(
    list,
    'exa',
    'name',
    `Искать открытые профили по имени «${fullName}»`,
    JSON.stringify([fullName, photoUrl]),
    {
      mode: 'people',
      fullName,
      ...(photoUrl ? { photoUrl } : {}),
    },
  );
  addWorkContextItems(list, draft, fullName, photoUrl, manualEmployers);
}

function extractUsernamesAndLinks(draft: ResumeDraft): {
  readonly usernames: readonly string[];
  readonly links: readonly string[];
} {
  const contact = draft.candidate.contact;
  const rawCandidateLinks = [
    ...(contact?.links ?? []),
    normalizeLinkedin(contact?.linkedinUrl) ?? contact?.linkedinUrl,
  ];
  const links = rawCandidateLinks.map(profileUrl).filter((v): v is string => v !== null);
  const usernames = new Set<string>();
  const tgUser = usernameFromTelegram(contact?.telegram);
  if (tgUser) usernames.add(tgUser);

  for (const raw of rawCandidateLinks) {
    if (!raw) continue;
    const url = profileUrl(raw);
    if (url) {
      const u = usernameFromProfileUrl(url);
      if (u) usernames.add(u);
    } else {
      const match = raw.trim().match(/^@?([A-Za-z0-9._-]{2,64})$/u);
      if (match) usernames.add(match[1]);
    }
  }

  const allLinks = [...new Set(links)];
  const hasLinkedinLink = allLinks.some((l) => l.includes('linkedin.com'));
  if (!hasLinkedinLink) {
    for (const u of usernames) {
      const li = `https://www.linkedin.com/in/${u}`;
      if (profileUrl(li)) allLinks.push(li);
    }
  }
  return { usernames: [...usernames], links: allLinks };
}

export interface BuildFootprintQueryPlanOptions {
  readonly manualEmployers?: readonly string[];
}

export function buildCandidateFootprintQueryPlan(
  draft: ResumeDraft,
  options?: BuildFootprintQueryPlanOptions,
): readonly FootprintQueryPlanItem[] {
  const { usernames, links } = extractUsernamesAndLinks(draft);
  const plan: FootprintQueryPlanItem[] = [];
  addUsernameItems(plan, usernames);
  addIdentityItems(plan, draft, usernames.length > 0, options?.manualEmployers);
  for (const link of links) {
    addItem(plan, 'wayback', 'profile_url', `Проверить архив публичной страницы ${link}`, link, {
      profileUrl: link,
    });
  }
  return plan;
}

export function extractUnidentifiedEmployers(draft: ResumeDraft): readonly string[] {
  const rawEmployers = draft.experience
    .map((item) => item.employer?.trim())
    .filter((item): item is string => Boolean(item));
  const { unidentifiedEmployers } = partitionEmployers(rawEmployers);
  return unidentifiedEmployers;
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
  return plan.map(({ id, adapterId, kind, preview, selectedByDefault, input }) => {
    let available = availability[adapterId] ?? true;
    if (adapterId === 'hibp' && 'email' in input && !input.email) {
      available = false;
    }
    return {
      id,
      adapterId,
      kind,
      preview,
      selectedByDefault: selectedByDefault && available,
      available,
    };
  });
}
