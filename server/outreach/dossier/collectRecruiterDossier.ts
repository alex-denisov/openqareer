import type { RecruiterChannel } from '../../../shared/recruiterChannel';
import { rankChannels } from '../../../shared/recruiterChannel';
import { searchExaPages } from '../../osint/adapters/exaAdapter';
import type { FootprintRequestGate } from '../../osint/adapters/requestScheduler';
import { sharedFootprintRequestGate } from '../../osint/adapters/requestScheduler';
import { transliterateToLatin } from '../recruiterIntelligenceService';
import { getCuratedMaigretSite } from '../../osint/adapters/maigretSiteCatalogue';
import type { MaigretSite } from '../../osint/adapters/maigretSiteCatalogue';
import { createUsernamePresenceAdapter } from '../../osint/adapters/usernamePresenceAdapter';
import { fetchPublicPage, isContactBroker } from './companyPages';
import { extractChannels } from './extractChannels';
import type { PersonIdentity } from './identity';
import { buildIdentity, CONFIRMED_THRESHOLD, LINK_THRESHOLD, linkEvidence } from './identity';

/**
 * Сводка каналов рекрутёра (B258): каналы связи из открытых источников, где их
 * опубликовал сам человек или компания. Утечки, базы «пробива» и догадки
 * личных телефонов не используются. Каждый канал несёт адрес страницы-источника.
 */
export interface DossierPerson {
  readonly fullName: string;
  readonly companyName: string;
  readonly companyDomain?: string;
  /** Исходный профиль человека: из него берутся прошлые работодатели и город. */
  readonly linkedinUrl?: string | null;
  /** Каналы, уже известные из вакансии и поиска рекрутёра. */
  readonly known?: readonly RecruiterChannel[];
}

/** Сбор неполный, если источник ответил ошибкой: такой результат не кэшируется. */
export interface DossierResult {
  readonly channels: RecruiterChannel[];
  readonly complete: boolean;
}

interface RunState {
  failed: boolean;
  githubBlocked: boolean;
}

export interface DossierDeps {
  readonly exaApiKey: string | undefined;
  readonly fetch?: typeof fetch;
  readonly requestGate?: FootprintRequestGate;
  readonly now?: () => Date;
  /** Адреса хоста для проверки, что сайт компании не во внутренней сети. */
  readonly lookupHost?: (host: string) => Promise<readonly string[]>;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 200_000;
const EXA_PAGES = 8;
const EXA_PAGE_CHARS = 4_000;
const GITHUB_CANDIDATES = 3;
const TELEGRAM_NICKS = 8;
const PROFILE_NICKS = 2;
const PROFILE_HEAD_CHARS = 1_500;
/** Сайт, ответивший отказом, не спрашивается час — для всех людей и заданий процесса. */
const REFUSAL_COOLDOWN_MS = 3_600_000;
const REFUSED_UNTIL = new Map<string, number>();

/** Для тестов: сброс отказов сайтов между сценариями. */
export function resetProfileRefusals(): void {
  REFUSED_UNTIL.clear();
}
/** Сайты из списка Maigret/Sherlock, где рекрутёры ведут профили с контактами в описании. */
export const RECRUITER_PROFILE_SITES = [
  'Medium', 'Teletype', 'SlideShare', 'Speakerdeck', 'sessionize.com', 'clarity.fm',
  'ProductHunt', 'Hashnode', 'DEV Community', 'Behance', 'write.as',
] as const;

function fold(value: string): string {
  return transliterateToLatin(value.normalize('NFKC')).replace(/[\s._-]+/gu, ' ').trim();
}

export function namesPerson(text: string, fullName: string): boolean {
  const page = fold(text);
  const parts = fold(fullName).split(' ').filter((part) => part.length > 1);
  return parts.length >= 2 && parts.every((part) => page.includes(part));
}

export function namesCompany(text: string, companyName: string): boolean {
  const company = fold(companyName).replace(/\s+/gu, '');
  return company.length > 1 && fold(text).replace(/\s+/gu, '').includes(company);
}

async function getText(url: string, deps: DossierDeps, accept: string, state: RunState): Promise<string | null> {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const gate = deps.requestGate ?? sharedFootprintRequestGate;
  const host = new URL(url).hostname;
  try {
    return await gate.run(host, AbortSignal.timeout(REQUEST_TIMEOUT_MS), async () => {
      const response = await fetcher(url, {
        headers: { accept, 'user-agent': 'openqareer-contact-check' },
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 403 || response.status === 429) {
        state.failed = true;
        if (host === 'api.github.com') state.githubBlocked = true;
        return null;
      }
      if (!response.ok) return null;
      return (await response.text()).slice(0, MAX_BODY_CHARS);
    });
  } catch {
    state.failed = true;
    return null;
  }
}

async function getJson<T>(url: string, deps: DossierDeps, state: RunState): Promise<T | null> {
  if (state.githubBlocked) return null;
  const text = await getText(url, deps, 'application/vnd.github+json', state);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const NEAR_NAME_CHARS = 400;

/** Фрагменты страницы рядом с упоминанием фамилии: чужие контакты со страницы не берутся. */
export function nearName(text: string, fullName: string): string {
  const parts = fullName.trim().split(/\s+/u);
  const surname = parts[parts.length - 1] ?? '';
  const lower = text.toLocaleLowerCase('ru-RU');
  const needle = surname.toLocaleLowerCase('ru-RU');
  if (needle.length < 2) return '';
  const windows: string[] = [];
  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + needle.length)) {
    windows.push(text.slice(Math.max(0, index - NEAR_NAME_CHARS), index + needle.length + NEAR_NAME_CHARS));
  }
  return windows.join('\n');
}

/**
 * Адрес со страницы принимается, только если в нём есть имя или фамилия
 * человека: рядом с именем на странице бывают чужие и обрезанные адреса.
 */
export function emailNamesPerson(email: string, fullName: string): boolean {
  const local = (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z]/gu, '');
  const parts = fold(fullName).toLowerCase().split(' ').filter((part) => part.length >= 3);
  return parts.some((part) => local.includes(part.replace(/[^a-z]/gu, '')));
}

function onCompanySite(url: string, domain: string | undefined): boolean {
  if (!domain) return false;
  try {
    const host = new URL(url).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

async function fromOpenPages(
  person: DossierPerson,
  identityReady: Promise<PersonIdentity>,
  deps: DossierDeps,
  observedAt: string,
  state: RunState,
): Promise<RecruiterChannel[]> {
  if (!deps.exaApiKey) return [];
  try {
    const pages = await searchExaPages(`"${person.fullName}" ${person.companyName}`, deps.exaApiKey, AbortSignal.timeout(REQUEST_TIMEOUT_MS), {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.requestGate ? { requestGate: deps.requestGate } : {}),
      numResults: EXA_PAGES,
      contents: { text: { maxCharacters: EXA_PAGE_CHARS } },
    });
    const identity = await identityReady;
    return pages
      // Базы контактов — не публикация человека: их адреса не берутся (B258, без баз «пробива»).
      .filter((page) => !isContactBroker(page.url))
      .filter((page) => namesPerson(`${page.title}\n${page.text}`, person.fullName))
      .flatMap((page) => {
        // Страница с тем же именем может быть о однофамильце: нужна связь в графе соответствия.
        // Страница на сайте самой компании — та же связь, что работодатель в тексте.
        const score = linkEvidence(identity, `${page.title}\n${page.text}`).score + (onCompanySite(page.url, person.companyDomain) ? 2 : 0);
        return extractChannels(nearName(page.text, person.fullName), { companyDomain: person.companyDomain, sourceUrl: page.url, observedAt })
          .filter((channel) => channel.kind === 'email_corporate' || score >= LINK_THRESHOLD)
          .map((channel) => (channel.kind === 'email_corporate' || score >= CONFIRMED_THRESHOLD ? channel : { ...channel, status: 'hypothesis' as const }));
      })
      .filter((channel) => !channel.kind.startsWith('email_') || emailNamesPerson(channel.value, person.fullName));
  } catch {
    state.failed = true;
    return [];
  }
}

interface GithubUser {
  readonly login?: string;
  readonly name?: string | null;
  readonly company?: string | null;
  readonly bio?: string | null;
  readonly email?: string | null;
  readonly blog?: string | null;
  readonly twitter_username?: string | null;
  readonly html_url?: string;
}

function githubChannels(user: GithubUser, person: DossierPerson, observedAt: string): RecruiterChannel[] {
  const sourceUrl = user.html_url ?? `https://github.com/${user.login}`;
  const channel = (kind: RecruiterChannel['kind'], value: string, href: string | null): RecruiterChannel => ({
    kind, value, href, status: 'verified', sourceUrl, observedAt,
  });
  const found = [channel('github', user.login!, sourceUrl)];
  if (user.email) {
    found.push(...extractChannels(user.email, { companyDomain: person.companyDomain, sourceUrl, observedAt }));
  }
  if (user.twitter_username) found.push(channel('x', user.twitter_username, `https://x.com/${user.twitter_username}`));
  if (user.blog) {
    const href = /^https?:\/\//u.test(user.blog) ? user.blog : `https://${user.blog}`;
    try {
      found.push(channel('website', new URL(href).hostname.replace(/^www\./u, ''), href));
    } catch {
      // Невалидная ссылка в профиле — пропускаем.
    }
  }
  return found;
}

async function fromGithub(
  person: DossierPerson,
  deps: DossierDeps,
  observedAt: string,
  state: RunState,
): Promise<RecruiterChannel[]> {
  const query = encodeURIComponent(`${person.fullName} in:name type:user`);
  const search = await getJson<{ items?: Array<{ login?: string }> }>(
    `https://api.github.com/search/users?q=${query}&per_page=${GITHUB_CANDIDATES}`,
    deps,
    state,
  );
  const logins = (search?.items ?? []).flatMap((item) => (item.login ? [item.login] : [])).slice(0, GITHUB_CANDIDATES);
  const found: RecruiterChannel[] = [];
  for (const login of logins) {
    const user = await getJson<GithubUser>(`https://api.github.com/users/${encodeURIComponent(login)}`, deps, state);
    if (!user?.login || !user.name || !namesPerson(user.name, person.fullName)) continue;
    if (!namesCompany(`${user.company ?? ''} ${user.bio ?? ''}`, person.companyName)) continue;
    found.push(...githubChannels(user, person, observedAt));
  }
  return found;
}

/** Ники из найденных профилей и почт: с ними проверяется Telegram. */
function nicknames(channels: readonly RecruiterChannel[]): string[] {
  const nicks = channels.flatMap((channel) => {
    if (['x', 'instagram', 'github', 'facebook', 'vk'].includes(channel.kind)) return [channel.value];
    if (channel.kind === 'email_personal' || channel.kind === 'email_corporate') return [channel.value.split('@')[0]!];
    return [];
  });
  return [...new Set(nicks.map((nick) => nick.replace(/[.-]/gu, '_')))]
    .filter((nick) => /^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(nick))
    .slice(0, TELEGRAM_NICKS);
}

/**
 * Ники, которые люди чаще всего берут от имени: annasmith, anna_smith,
 * asmith, smithanna. Проверяются там, где ник открыт без входа (Telegram,
 * сайты Maigret); принимается только страница с тем же именем.
 */
export function nameNicknames(fullName: string): string[] {
  const parts = transliterateToLatin(fullName.normalize('NFKC')).replace(/[^a-z\s]/gu, '').split(/\s+/u).filter(Boolean);
  if (parts.length < 2) return [];
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  return [`${first}${last}`, `${first}_${last}`, `${first[0]}${last}`, `${last}${first}`, `${first}${last[0]}`]
    .filter((nick) => /^[a-z][a-z0-9_]{4,31}$/u.test(nick));
}

function metaContent(html: string, property: string): string | null {
  const match = new RegExp(`<meta property="${property}" content="([^"]{1,400})"`, 'u').exec(html);
  return match ? match[1]! : null;
}

function telegramTitle(html: string): string | null {
  return metaContent(html, 'og:title');
}

async function fromTelegramNicks(
  person: DossierPerson,
  identity: PersonIdentity,
  known: readonly RecruiterChannel[],
  deps: DossierDeps,
  observedAt: string,
  state: RunState,
): Promise<RecruiterChannel[]> {
  if (known.some((channel) => channel.kind === 'telegram')) return [];
  const found: RecruiterChannel[] = [];
  const linked = new Set(nicknames(known));
  const nicks = [...new Set([...linked, ...nameNicknames(person.fullName)])].slice(0, TELEGRAM_NICKS);
  for (const nick of nicks) {
    const url = `https://t.me/${nick}`;
    const html = (await getText(url, deps, 'text/html', state)) ?? '';
    const title = telegramTitle(html);
    // Страница без профиля называется «Telegram: Contact @nick» — имени человека в ней нет.
    // Пустой ник отдаёт «Telegram: Contact @nick»: ник из имени прошёл бы проверку имени сам.
    if (!title || /^Telegram:/u.test(title) || !namesPerson(title, person.fullName)) continue;
    // Одно имя — однофамилец, а не контакт: нужна связь с человеком в графе соответствия
    // (общий контакт, тот же ник, любой работодатель из истории, город, профессия).
    const bio = metaContent(html, 'og:description') ?? '';
    const score = linkEvidence(identity, `${title}\n${bio}`).score + (linked.has(nick) ? CONFIRMED_THRESHOLD : 0);
    if (score < LINK_THRESHOLD) continue;
    const status = score >= CONFIRMED_THRESHOLD ? 'published' : 'hypothesis';
    found.push({ kind: 'telegram', value: `@${nick}`, href: url, status, sourceUrl: url, observedAt });
    if (status === 'published') break;
  }
  return found;
}

/**
 * Профили по нику (Maigret/Sherlock): наличие ника — ещё не человек, поэтому
 * профиль принимается, только если на странице его имя; каналы — из описания.
 */
async function fromUsernameSites(
  person: DossierPerson,
  identity: PersonIdentity,
  known: readonly RecruiterChannel[],
  deps: DossierDeps,
  observedAt: string,
  state: RunState,
): Promise<RecruiterChannel[]> {
  const sites = RECRUITER_PROFILE_SITES.map((name) => getCuratedMaigretSite(name)).filter(
    (site): site is MaigretSite => Boolean(site),
  );
  const found: RecruiterChannel[] = [];
  const refused = new Set<string>(
    [...REFUSED_UNTIL].flatMap(([name, until]) => (until > Date.now() ? [name] : [])),
  );
  const refuse = (name: string) => {
    refused.add(name);
    REFUSED_UNTIL.set(name, Date.now() + REFUSAL_COOLDOWN_MS);
  };
  for (const nick of [...new Set([...nicknames(known), ...nameNicknames(person.fullName)])].slice(0, PROFILE_NICKS)) {
    for (const site of sites) {
      if (refused.has(site.name)) continue;
      const adapter = createUsernamePresenceAdapter(site.adapterId, {
        site,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.requestGate ? { requestGate: deps.requestGate } : {}),
      });
      let profileUrl: string | null = null;
      try {
        profileUrl = (await adapter.run({ username: nick }, AbortSignal.timeout(REQUEST_TIMEOUT_MS)))[0]?.url ?? null;
      } catch {
        // Сайт отказал (в том числе по частоте) — больше его в этом сборе не спрашиваем.
        refuse(site.name);
        state.failed = true;
        continue;
      }
      if (!profileUrl) continue;
      const page = await fetchPublicPage(profileUrl, deps);
      if (page.failed) {
        refuse(site.name);
        state.failed = true;
      }
      // Имя должно стоять в шапке профиля, а не где-то в ленте или блоке «похожие».
      if (!page.text || !namesPerson(page.text.slice(0, PROFILE_HEAD_CHARS), person.fullName)) continue;
      const score = linkEvidence(identity, page.text).score;
      if (score < LINK_THRESHOLD) continue;
      const status: RecruiterChannel['status'] = score >= CONFIRMED_THRESHOLD ? 'published' : 'hypothesis';
      found.push({ kind: 'other', value: profileUrl.replace(/^https:\/\//u, ''), href: profileUrl, status, sourceUrl: profileUrl, observedAt });
      found.push(
        ...extractChannels(nearName(page.text, person.fullName), { companyDomain: person.companyDomain, sourceUrl: profileUrl, observedAt })
          .filter((channel) => !channel.kind.startsWith('email_') || emailNamesPerson(channel.value, person.fullName))
          .map((channel) => ({ ...channel, status })),
      );
    }
  }
  return found;
}

const SEED_PAGES = 3;
const SEED_CHARS = 3_000;

function sameProfile(left: string, right: string): boolean {
  const norm = (url: string) => url.toLowerCase().replace(/^https?:\/\/([a-z]+\.)?linkedin\.com/u, '').replace(/\/$/u, '');
  return norm(left) === norm(right);
}

/** Исходный профиль человека (поиск по имени): текст с историей работы и городом. */
async function seedProfile(person: DossierPerson, deps: DossierDeps, state: RunState): Promise<{ texts: string[]; cities: string[] }> {
  if (!deps.exaApiKey) return { texts: [], cities: [] };
  try {
    const pages = await searchExaPages(`"${person.fullName}"`, deps.exaApiKey, AbortSignal.timeout(REQUEST_TIMEOUT_MS), {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.requestGate ? { requestGate: deps.requestGate } : {}),
      numResults: SEED_PAGES,
      includeDomains: ['linkedin.com'],
      contents: { text: { maxCharacters: SEED_CHARS } },
    });
    const own = pages.filter((page) =>
      person.linkedinUrl ? sameProfile(page.url, person.linkedinUrl) : namesPerson(page.title, person.fullName) && namesCompany(page.text, person.companyName),
    );
    // Вторая строка профиля Exa — город: «London, United Kingdom».
    const cities = own.flatMap((page) => (page.text.split('\n').map((line) => line.trim()).filter(Boolean)[2] ?? '').split(',').slice(0, 1).map((city) => city.trim()));
    return { texts: own.map((page) => `${page.title}\n${page.text}`), cities };
  } catch {
    state.failed = true;
    return { texts: [], cities: [] };
  }
}

export async function collectRecruiterDossier(person: DossierPerson, deps: DossierDeps): Promise<DossierResult> {
  const observedAt = (deps.now?.() ?? new Date()).toISOString();
  const state: RunState = { failed: false, githubBlocked: false };
  const failed = (): RecruiterChannel[] => {
    state.failed = true;
    return [];
  };
  const seedReady = seedProfile(person, deps, state);
  const baseIdentity = seedReady.then((seed) =>
    buildIdentity({ fullName: person.fullName, companyName: person.companyName, seedTexts: seed.texts, cities: seed.cities, known: person.known }),
  );
  const [pages, github, seed] = await Promise.all([
    fromOpenPages(person, baseIdentity, deps, observedAt, state),
    fromGithub(person, deps, observedAt, state).catch(failed),
    seedReady,
  ]);
  const known = [...(person.known ?? []), ...pages, ...github];
  const identity = buildIdentity({ fullName: person.fullName, companyName: person.companyName, seedTexts: seed.texts, cities: seed.cities, known });
  const [telegram, profiles] = await Promise.all([
    fromTelegramNicks(person, identity, known, deps, observedAt, state).catch(failed),
    fromUsernameSites(person, identity, known, deps, observedAt, state).catch(failed),
  ]);
  return { channels: rankChannels([...pages, ...github, ...telegram, ...profiles]), complete: !state.failed };
}
