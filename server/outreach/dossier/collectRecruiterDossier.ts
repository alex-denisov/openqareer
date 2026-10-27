import type { RecruiterChannel } from '../../../shared/recruiterChannel';
import { rankChannels } from '../../../shared/recruiterChannel';
import { searchExaPages } from '../../osint/adapters/exaAdapter';
import type { FootprintRequestGate } from '../../osint/adapters/requestScheduler';
import { sharedFootprintRequestGate } from '../../osint/adapters/requestScheduler';
import { transliterateToLatin } from '../recruiterIntelligenceService';
import { extractChannels } from './extractChannels';

/**
 * Сводка каналов рекрутёра (B258): каналы связи из открытых источников, где их
 * опубликовал сам человек или компания. Утечки, базы «пробива» и догадки
 * личных телефонов не используются. Каждый канал несёт адрес страницы-источника.
 */
export interface DossierPerson {
  readonly fullName: string;
  readonly companyName: string;
  readonly companyDomain?: string;
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
const TELEGRAM_NICKS = 4;

function fold(value: string): string {
  return transliterateToLatin(value.normalize('NFKC')).replace(/[\s._-]+/gu, ' ').trim();
}

function namesPerson(text: string, fullName: string): boolean {
  const page = fold(text);
  const parts = fold(fullName).split(' ').filter((part) => part.length > 1);
  return parts.length >= 2 && parts.every((part) => page.includes(part));
}

function namesCompany(text: string, companyName: string): boolean {
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
function nearName(text: string, fullName: string): string {
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

async function fromOpenPages(
  person: DossierPerson,
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
    return pages
      .filter((page) => namesPerson(`${page.title}\n${page.text}`, person.fullName))
      .flatMap((page) =>
        extractChannels(nearName(page.text, person.fullName), { companyDomain: person.companyDomain, sourceUrl: page.url, observedAt }),
      )
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

function telegramTitle(html: string): string | null {
  const match = /<meta property="og:title" content="([^"]{1,200})"/u.exec(html);
  return match ? match[1]! : null;
}

async function fromTelegramNicks(
  person: DossierPerson,
  known: readonly RecruiterChannel[],
  deps: DossierDeps,
  observedAt: string,
  state: RunState,
): Promise<RecruiterChannel[]> {
  if (known.some((channel) => channel.kind === 'telegram')) return [];
  const found: RecruiterChannel[] = [];
  for (const nick of nicknames(known)) {
    const url = `https://t.me/${nick}`;
    const title = telegramTitle((await getText(url, deps, 'text/html', state)) ?? '');
    // Страница без профиля называется «Telegram: Contact @nick» — имени человека в ней нет.
    if (title && namesPerson(title, person.fullName)) {
      found.push({ kind: 'telegram', value: `@${nick}`, href: url, status: 'hypothesis', sourceUrl: url, observedAt });
    }
  }
  return found;
}

export async function collectRecruiterDossier(person: DossierPerson, deps: DossierDeps): Promise<DossierResult> {
  const observedAt = (deps.now?.() ?? new Date()).toISOString();
  const state: RunState = { failed: false, githubBlocked: false };
  const failed = (): RecruiterChannel[] => {
    state.failed = true;
    return [];
  };
  const [pages, github] = await Promise.all([
    fromOpenPages(person, deps, observedAt, state),
    fromGithub(person, deps, observedAt, state).catch(failed),
  ]);
  const known = [...pages, ...github];
  const telegram = await fromTelegramNicks(person, known, deps, observedAt, state).catch(failed);
  return { channels: rankChannels([...known, ...telegram]), complete: !state.failed };
}
