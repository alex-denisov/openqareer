/**
 * Адреса публичного каталога вакансий (B209, срез 2).
 *
 * Правило владельца дословно: «Только естественный чистый английский
 * семантический URL… Транслитерация строго запрещена, за исключением исконно
 * российских реалий/программных продуктов без английского эквивалента.»
 *
 * Отсюда главное свойство модуля: **он умеет отказаться**. Роль, которую
 * нечем назвать по-английски, не получает адреса вовсе — и вакансия просто не
 * попадает в публичный каталог и в карту сайта. Это честнее, чем выдать
 * `razrabotchik-interfeisov` и потом объяснять, почему правило нарушено.
 */
import { canonicalRoleWord } from './roleSynonyms';
import { isValidPublicPath } from './seoSlugPolicy';

export const CATALOG_ROOT = '/vacancies';
const JOB_SEGMENT = 'job';
const PAGE_SEGMENT = 'page';

/**
 * Слова роли, которых нет в таблице склейки гипотез, но которые нужны адресу.
 * Таблица `roleSynonyms` служит другой работе — сведению наблюдений рынка, — и
 * раздувать её ради адресов значило бы менять поведение гипотез.
 */
const CATALOG_ROLE_WORDS: Readonly<Record<string, string>> = {
  интерфейсов: 'frontend',
  интерфейса: 'frontend',
  данных: 'data',
  данные: 'data',
  продаж: 'sales',
  закупок: 'procurement',
  поддержки: 'support',
  безопасности: 'security',
  качества: 'quality',
  проектов: 'project',
  продукта: 'product',
  систем: 'systems',
  сетей: 'network',
  баз: 'database',
  мобильной: 'mobile',
  мобильных: 'mobile',
  ведущий: 'lead',
  старший: 'senior',
  младший: 'junior',
  главный: 'principal',
};

/** Служебные слова, которые в адресе не нужны ни на каком языке. */
const STOP_WORDS = new Set(['по', 'в', 'на', 'и', 'the', 'of', 'a', 'an', 'for']);

/**
 * Роль вокруг 1С — исключение, названное владельцем. Английского эквивалента у
 * неё нет, поэтому здесь транслитерация не нарушение правила, а его пункт.
 */
const ONE_C_ROLE_WORDS: Readonly<Record<string, string>> = {
  программист: 'programmist',
  разработчик: 'razrabotchik',
  аналитик: 'analitik',
  консультант: 'konsultant',
  специалист: 'specialist',
  архитектор: 'arhitektor',
  методист: 'metodist',
};

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN_TOKEN = /^[a-z0-9]+$/u;

function tokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[«»"'`]/gu, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

function mentionsOneC(parts: readonly string[]): boolean {
  return parts.some((token) => token === '1c' || token === '1с');
}

/** Английское слово для русского, или `null`, когда его нет. */
function translate(token: string): string | null {
  if (LATIN_TOKEN.test(token)) return token;
  const catalog = CATALOG_ROLE_WORDS[token];
  if (catalog) return catalog;
  const shared = canonicalRoleWord(token);
  return shared !== token && LATIN_TOKEN.test(shared) ? shared : null;
}

/**
 * Слаг роли: естественный английский или `null`.
 *
 * Русское название строится «главное слово — уточнение» («аналитик данных»), а
 * английское наоборот («data analyst»), поэтому переведённые слова целиком
 * русской фразы разворачиваются. Смешанную фразу не разворачиваем: порядок в
 * ней задал автор, и угадывать его — то же гадание.
 */
export function buildVacancySlug(title: string): string | null {
  const parts = tokens(title);
  if (parts.length === 0) return null;

  if (mentionsOneC(parts)) {
    // Исключение владельца называет роль вокруг 1С («programmist-1c»), а не
    // саму цифру. «ИТ-лидер команды (1с, финансовый блок)» роли не называет —
    // адрес `/vacancies/job/1c-…` не сказал бы читателю ничего, поэтому
    // отказываемся так же, как и в общем случае (найдено на живом пуле).
    const role = parts.find(
      (token) => ONE_C_ROLE_WORDS[token] ?? (LATIN_TOKEN.test(token) && token !== '1c'),
    );
    if (!role) return null;
    return `${ONE_C_ROLE_WORDS[role] ?? role}-1c`;
  }

  const translated: string[] = [];
  for (const token of parts) {
    const word = translate(token);
    if (!word) return null;
    translated.push(word);
  }

  const allCyrillic = parts.every((token) => CYRILLIC.test(token));
  const ordered = allCyrillic ? [...translated].reverse() : translated;
  const slug = ordered.join('-');
  return slug.length > 0 ? slug : null;
}

/**
 * Короткий устойчивый ключ вакансии для адреса. Идентификатор кластера несёт
 * дефисы и двоеточия — по такому адресу нельзя понять, где кончилось название
 * и начался идентификатор. FNV-1a, а не хеш из `node:crypto`: модуль общий и
 * работает в браузере тоже.
 */
export function vacancyKey(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export interface VacancyPathInput {
  readonly id: string;
  readonly title: string;
  readonly company: string;
}

/** Адрес карточки вакансии, или `null`, если правило адресов его не пропускает. */
export function vacancyPath(vacancy: VacancyPathInput): string | null {
  const role = buildVacancySlug(vacancy.title);
  if (!role) return null;

  // Имя работодателя — собственное, и переводить его нечем. Не ложится в
  // английский адрес — уходит из адреса, а не превращается в транслит.
  const companySlug = tokens(vacancy.company)
    .filter((token) => LATIN_TOKEN.test(token))
    .join('-');
  const middle = companySlug ? `${role}-at-${companySlug}` : role;
  const path = `${CATALOG_ROOT}/${JOB_SEGMENT}/${middle}-${vacancyKey(vacancy.id)}`;
  return isValidPublicPath(path) ? path : null;
}

/** Короткий ключ из адреса карточки, или `null`, если это не карточка. */
export function parseVacancyPath(path: string): string | null {
  const clean = path.split('?')[0]?.replace(/\/$/u, '') ?? '';
  const prefix = `${CATALOG_ROOT}/${JOB_SEGMENT}/`;
  if (!clean.startsWith(prefix)) return null;
  const rest = clean.slice(prefix.length);
  if (!rest || rest.includes('/')) return null;
  const key = rest.split('-').at(-1);
  return key && key.length > 0 ? key : null;
}

/** Адрес страницы каталога. Первая страница живёт в корне, а не в `/page/1`. */
export function catalogPagePath(page: number): string {
  return page <= 1 ? CATALOG_ROOT : `${CATALOG_ROOT}/${PAGE_SEGMENT}/${page}`;
}
