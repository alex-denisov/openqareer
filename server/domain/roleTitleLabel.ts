/**
 * Источники кладут в навыки вакансии название должности: «CTO», «VP-Of-Engineering»,
 * «Customer-Success-Director» (прод, 04.11). Это не то, чему можно научиться или что
 * можно дописать в профиль, поэтому ни в спрос на навыки, ни в ключевые слова ATS оно не идёт.
 *
 * Сравнивается вся подпись целиком: «CTO-office tooling» и «Director-level communication» —
 * не должности. CRO в списке нет: чаще это conversion rate optimization.
 */
const ROLE_TITLE_PATTERNS: readonly RegExp[] = [
  /^(?:ceo|cto|cio|cfo|coo|cpo|cmo|cdo|chro|ciso)$/u,
  /^chief .*officer$/u,
  /^(?:vp|svp|evp|vice president)(?: |$)/u,
  /^head of /u,
  /^director(?: (?!level(?: |$))|$)|(?:^| )director$/u,
  /^(?:engineering|product|project|program|delivery) manager$/u,
  /^(?:tech|team) lead$|^тимлид$/u,
  /^(?:вице президент|руководитель|начальник)(?: |$)/u,
  /^директор(?: |$)|(?:^| )директор$/u,
];

export function isRoleTitleLabel(label: string): boolean {
  const normalized = label
    .toLowerCase()
    .replace(/[\s,_-]+/gu, ' ')
    .trim();
  return ROLE_TITLE_PATTERNS.some((pattern) => pattern.test(normalized));
}
