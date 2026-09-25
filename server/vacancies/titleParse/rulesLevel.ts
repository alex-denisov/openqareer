import type { SeniorityLevel } from '../levelMatcher';

/**
 * Уровень должности для `rulesParse` (B267 S1). Отдельная от `evaluateLevelMatch`
 * шкала: та обязана возвращать `undefined`, когда заголовок не называет
 * уровень (PRB-016 — fit-dot не должен выдумывать соответствие), а
 * `title_parse` наоборот обязан дать честную оценку почти всегда — реальная
 * выборка показала 68% `null`, что делает подбор по уровню бесполезным.
 *
 * Отличия от `evaluateLevelMatch` (осознанные, не баг):
 *  - «Director» без уточнения — `head`, «Senior Director»/«VP» — `vp`,
 *    «CIO»/«Chief …» — `c-level`. Обычный `evaluateLevelMatch` проверяет
 *    «director» раньше «senior director» тоже даёт `head`; здесь порядок
 *    меняется явно под слова из CPO-отчёта.
 *  - Заголовок без единого маркера уровня — `ic`, а не `undefined`:
 *    подавляющее большинство таких названий («Software Engineer», «Account
 *    Executive») действительно рядовые позиции.
 */
const C_LEVEL_MARKERS = [
  'chief', 'cto', 'cpo', 'ceo', 'coo', 'cfo', 'cmo', 'ciso', 'chro', 'cro', 'cio',
  'generaldirector', 'генеральный директор',
];

const VP_MARKERS = [
  'vice president', 'vice-president', 'vp of', 'vp,', ' vp ', 'svp', 'evp',
  'senior director', 'sr. director', 'sr director', 'вице-президент',
];

const HEAD_MARKERS = [
  'head of', 'head,', ' head ', 'director', 'руководитель отдела', 'руководитель направления',
  'руководитель', 'директор',
];

const LEAD_MARKERS = [
  'tech lead', 'team lead', 'lead ', 'lead,', 'тимлид', 'тим-лид',
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Маркеры вроде «cro» иначе совпали бы внутри «coordinator» — границы по
 * не-буквам обязательны (та же защита, что в `rulesParse.findAnchorHits`).
 */
function containsAny(normalizedTitle: string, markers: readonly string[]): boolean {
  return markers.some((marker) => {
    const trimmed = marker.trim();
    const pattern = new RegExp(`(?<![\\p{L}])${escapeRegExp(trimmed)}(?![\\p{L}])`, 'u');
    return pattern.test(normalizedTitle);
  });
}

/** Заголовок нормализуется до нижнего регистра с пробелами по краям для якорей с пробелами внутри. */
export function inferRulesLevel(title: string): SeniorityLevel {
  const normalized = ` ${title.toLowerCase()} `;
  if (containsAny(normalized, C_LEVEL_MARKERS)) return 'c-level';
  if (containsAny(normalized, VP_MARKERS)) return 'vp';
  if (containsAny(normalized, HEAD_MARKERS)) return 'head';
  if (containsAny(normalized, LEAD_MARKERS)) return 'lead';
  return 'ic';
}
