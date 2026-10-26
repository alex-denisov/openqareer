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
  'chief',
  'cto',
  'cpo',
  'ceo',
  'coo',
  'cfo',
  'cmo',
  'ciso',
  'chro',
  'cro',
  'cio',
  'generaldirector',
  'генеральный директор',
  'технический директор',
  'директор по информационным технологиям',
];

const VP_MARKERS = [
  'vice president',
  'vice-president',
  'vp of',
  'vp,',
  ' vp ',
  'svp',
  'evp',
  'senior director',
  'sr. director',
  'sr director',
  'вице-президент',
];

const HEAD_MARKERS = [
  'head of',
  'head,',
  ' head ',
  'director',
  'руководитель отдела',
  'руководитель направления',
  'руководитель',
  'директор',
  'ディレクター',
  '責任者',
  'マネージャー',
  '部長',
  '主管',
  '总监',
  '经理',
];

/** CPO 26.10: Senior Manager — руководитель группы (lead), не Head. */
const SENIOR_MANAGER_MARKERS = ['senior manager', 'sr. manager', 'sr manager'];

/**
 * CPO 26.10: «Senior Engineering Manager», «Senior Product Marketing Manager» —
 * то же, что Senior Manager: между словами может стоять до трёх слов функции.
 */
const SENIOR_X_MANAGER =
  /(?<![\p{L}])(?:senior|sr\.?)\s+(?:[\p{L}&/-]+\s+){1,3}manager(?![\p{L}])/u;

/**
 * CPO 26.10: «Руководитель группы …» — lead, даже рядом с «Head of» в
 * двуязычном заголовке hh. Director/VP/C-level сильнее.
 */
const GROUP_LEAD_MARKERS = ['руководитель группы', 'group lead', 'group leader'];

const LEAD_MARKERS = [
  ...GROUP_LEAD_MARKERS,
  ...SENIOR_MANAGER_MARKERS,
  'tech lead',
  'team lead',
  'lead ',
  'lead,',
  'тимлид',
  'тим-лид',
  'リーダー',
];

const CJK_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/u;

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
    if (CJK_SCRIPT.test(trimmed)) return normalizedTitle.includes(trimmed);
    const pattern = new RegExp(`(?<![\\p{L}])${escapeRegExp(trimmed)}(?![\\p{L}])`, 'u');
    return pattern.test(normalizedTitle);
  });
}

/** Отличает явно названный уровень от штатного IC-фолбэка. */
export function hasRulesLevelMarker(title: string): boolean {
  const normalized = ` ${title.toLowerCase()} `;
  return (
    SENIOR_X_MANAGER.test(normalized) ||
    [C_LEVEL_MARKERS, VP_MARKERS, HEAD_MARKERS, LEAD_MARKERS].some((markers) =>
      containsAny(normalized, markers),
    )
  );
}

/**
 * Senior Manager без маркера Head/VP/C-level: такой заголовок правила читают
 * как lead, и разбор модели с уровнем выше переписывается (CPO 26.10).
 */
export function isSeniorManagerLead(title: string): boolean {
  const normalized = ` ${title.toLowerCase()} `;
  const named =
    containsAny(normalized, SENIOR_MANAGER_MARKERS) ||
    SENIOR_X_MANAGER.test(normalized) ||
    containsAny(normalized, GROUP_LEAD_MARKERS);
  return named && inferRulesLevel(title) === 'lead';
}

function isHeadOnlyMarker(normalized: string): boolean {
  return containsAny(normalized, HEAD_MARKERS) && !containsAny(normalized, GROUP_LEAD_MARKERS);
}

function hasDirectorMarker(normalized: string): boolean {
  return containsAny(normalized, ['director', 'директор']);
}

/** Заголовок нормализуется до нижнего регистра с пробелами по краям для якорей с пробелами внутри. */
export function inferRulesLevel(title: string): SeniorityLevel {
  const normalized = ` ${title.toLowerCase()} `;
  if (containsAny(normalized, C_LEVEL_MARKERS)) return 'c-level';
  if (containsAny(normalized, VP_MARKERS)) return 'vp';
  if (isHeadOnlyMarker(normalized) || hasDirectorMarker(normalized)) return 'head';
  if (containsAny(normalized, LEAD_MARKERS) || SENIOR_X_MANAGER.test(normalized)) return 'lead';
  return 'ic';
}
