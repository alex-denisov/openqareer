import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';

/**
 * На каком языке печатать название роли (B180, решение владельца 2026-09-03).
 *
 * Язык названия — не свойство кандидата и не свойство интерфейса, а свойство
 * рынка, на котором эту работу объявляют. Кандидат название не читает, а
 * использует: вбивает в поиск, произносит рекрутеру, ставит в заголовок
 * профиля — везде работает узнаваемость строки, а не верность перевода.
 * Поэтому подписи панели переводятся на язык кандидата, а название роли — нет.
 *
 * Решает **код, а не модель**. До этой лестницы язык названия был побочным
 * эффектом выбора провайдера: смена головы очереди с Nemotron на Gemini
 * переписала кандидату его же роли с английских на русские. Факт о человеке не
 * должен меняться оттого, что мы поменяли поставщика.
 *
 * Лестница признаков — решение владельца 2026-09-03 по итогам двух записок
 * (`B180-brainstorm-language-expert.md`, `B180-brainstorm-language-strategist.md`).
 * Первая ступень лестницы — доминирующая форма среди **подтверждающих
 * вакансий** — сознательно не реализована: пул сегодня не подтверждает ни одной
 * роли, и считать язык по нулю наблюдений значило бы выдать домысел за рынок.
 * Она войдёт вместе с подтверждением ролей.
 */
export type RoleNameLanguage = 'en' | 'ru';

export type RoleNameLanguageReason =
  | 'markets'
  | 'level'
  | 'resume-language'
  | 'default';

export interface RoleNameLanguageInput {
  /** Где кандидат ищет работу. Пустой список — честное «ещё не сказал». */
  readonly searchRegions?: readonly CandidateRegion[];
  /** Целевые роли кандидата — по ним считается уровень. */
  readonly targetRoles?: readonly string[];
  /** Текст резюме или фактов: по нему определяется язык кандидата. */
  readonly resumeText?: string;
}

export interface RoleNameLanguageDecision {
  readonly language: RoleNameLanguage;
  /** Признак, который сработал: отчёт обязан совпадать с поведением (B183). */
  readonly reason: RoleNameLanguageReason;
}

/** Рынки, на которых вакансии объявляют по-русски. Остальные — нет. */
const RUSSIAN_SPEAKING_REGIONS: readonly CandidateRegion[] = ['ru', 'cis'];

/**
 * Уровень роли — **слабый признак и прокси**, поэтому стоит ниже рынка поиска.
 *
 * Владелец сформулировал его как «C-level или директор → английский», и вывод
 * верен, но не из-за уровня: у executive-аббревиатур русского эквивалента того
 * же мандата попросту нет (CIO ≠ «Директор по информационным технологиям»,
 * COO ≠ «Операционный директор»), а контур найма на этом уровне международный.
 * Само по себе слово «директор» язык не решает — русскоязычный директор
 * производства ищет по-русски, и рынок поиска обязан его перебить.
 */
const EXECUTIVE_TITLE = /\b(?:C[EIOTFPM]O|CxO|VP|SVP|EVP|Chief|Head\s+of)\b/iu;

function isExecutive(role: string): boolean {
  return EXECUTIVE_TITLE.test(role);
}

/** Кириллицы больше, чем латиницы, — текст русский. */
function looksRussian(text: string): boolean {
  const cyrillic = text.match(/[Ѐ-ӿ]/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/gu)?.length ?? 0;
  return cyrillic > latin;
}

export function resolveRoleNameLanguage(
  input: RoleNameLanguageInput,
): RoleNameLanguageDecision {
  const regions = input.searchRegions ?? [];
  if (regions.length > 0) {
    // Несколько рынков или хоть один нерусскоязычный — английский: он понятен
    // на обоих, русский — только на одном.
    const russianOnly = regions.every((region) =>
      RUSSIAN_SPEAKING_REGIONS.includes(region),
    );
    return { language: russianOnly ? 'ru' : 'en', reason: 'markets' };
  }

  if ((input.targetRoles ?? []).some(isExecutive)) {
    return { language: 'en', reason: 'level' };
  }

  const resumeText = input.resumeText ?? '';
  if (resumeText.trim().length > 0) {
    return {
      language: looksRussian(resumeText) ? 'ru' : 'en',
      reason: 'resume-language',
    };
  }

  // Не знаем ничего. Английский — не «правильнее», а дешевле исправимая
  // ошибка: русское имя на англоязычном рынке делает кандидата невидимым, и
  // пустую выдачу он прочитает как факт о рынке, а не о своём запросе.
  return { language: 'en', reason: 'default' };
}
