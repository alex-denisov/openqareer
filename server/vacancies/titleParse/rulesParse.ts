import { ROLE_TAXONOMY, type FunctionCode } from '../../../shared/roleTaxonomy';
import { LEVEL_RANK } from '../levelMatcher';
import { inferRulesLevel } from './rulesLevel';

/**
 * Фолбэк без модели (B267 §3): опорные слова словаря дают функцию, уже
 * существующий `inferSeniorityLevel` — уровень. Если модели недоступны,
 * подбор работает целиком на правилах — хуже, но честно, без добивки.
 */
export interface RulesParseResult {
  readonly functions: readonly FunctionCode[];
  readonly levelRank: number | null;
}

interface AnchorHit {
  readonly code: FunctionCode;
  readonly anchor: string;
}

interface AnchorMatcher extends AnchorHit {
  readonly compactPattern: RegExp | null;
  readonly pattern: RegExp | null;
}

const CJK_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/u;
const COMPACT_CJK_LATIN_ANCHORS: ReadonlySet<string> = new Set(['pm', 'pl']);

const ANCHOR_MATCHERS: readonly AnchorMatcher[] = ROLE_TAXONOMY.flatMap((definition) =>
  definition.anchors.map((anchor) => {
    const compactLatin = COMPACT_CJK_LATIN_ANCHORS.has(anchor);
    return {
      code: definition.code,
      anchor,
      compactPattern: compactLatin ? new RegExp(`(?<![a-z])${anchor}(?![a-z])`, 'u') : null,
      pattern: CJK_SCRIPT.test(anchor)
        ? null
        : new RegExp(`(?<![\\p{L}])${escapeRegExp(anchor)}(?![\\p{L}])`, 'u'),
    };
  }),
);

function matchesAnchor(normalizedTitle: string, matcher: AnchorMatcher, compactTitle: boolean): boolean {
  if (!normalizedTitle.includes(matcher.anchor)) return false;
  if (matcher.pattern === null) return true;
  if (compactTitle && matcher.compactPattern) return matcher.compactPattern.test(normalizedTitle);
  return matcher.pattern.test(normalizedTitle);
}

/**
 * Заголовок нормализуется до нижнего регистра и границ по не-буквам, чтобы
 * якорь «vp sales» не совпал внутри «vp salesforce».
 */
function findAnchorHits(normalizedTitle: string): AnchorHit[] {
  const hits: AnchorHit[] = [];
  const compactTitle = CJK_SCRIPT.test(normalizedTitle);
  for (const matcher of ANCHOR_MATCHERS) {
    if (matchesAnchor(normalizedTitle, matcher, compactTitle)) {
      hits.push({ code: matcher.code, anchor: matcher.anchor });
    }
  }
  return hits;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Общие для должностей слова без привязки к функции: заголовок явно называет
 * роль, но словарь не знает домена (B267 S1 §3). Возвращаем честный код
 * `other` вместо пустого списка — это ограничено ≤10% выборки в тесте на
 * фикстуре, а не используется как замена словарю.
 */
const GENERIC_ROLE_WORD = new RegExp(
  '(?<![\\p{L}])(' +
    [
      'manager', 'director', 'specialist', 'analyst', 'coordinator', 'supervisor', 'associate',
      'executive', 'lead', 'expert', 'administrator', 'representative', 'consultant', 'intern',
      'apprentice', 'partner', 'officer', 'staff', 'agent', 'clerk', 'driver', 'guide', 'buyer',
      'strategist', 'principal', 'leader', 'processor', 'trainee', 'apprenticeship',
      'ejecutivo', 'ejecutiva', 'especialista', 'gerente', 'diretor', 'directora', 'executivo',
      'executiva', 'vendedor', 'vendedora', 'consultor', 'consultora', 'analista', 'coordenador',
      'coordenadora', 'responsable', 'ingeniero', 'responsavel',
    ].join('|') +
    ')(?![\\p{L}])',
  'iu',
);

function pickFallbackFunction(normalizedTitle: string): FunctionCode[] {
  return GENERIC_ROLE_WORD.test(normalizedTitle) ? ['other'] : [];
}

/**
 * Более длинный (специфичный) якорь побеждает: «vp of engineering» важнее
 * общего «engineer» в том же названии. При равной длине сохраняется порядок
 * словаря — не больше двух функций на строку (B267 §2).
 */
function pickTopFunctions(hits: readonly AnchorHit[]): FunctionCode[] {
  const bestByCode = new Map<FunctionCode, number>();
  for (const hit of hits) {
    const specificity = CJK_SCRIPT.test(hit.anchor) ? hit.anchor.length : hit.anchor.split(' ').length;
    const current = bestByCode.get(hit.code) ?? 0;
    if (specificity > current) bestByCode.set(hit.code, specificity);
  }
  return [...bestByCode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([code]) => code);
}

export function rulesParse(title: string): RulesParseResult {
  const normalized = ` ${title.toLowerCase()} `;
  const hits = findAnchorHits(normalized);
  const specificFunctions = pickTopFunctions(hits);
  const functions = specificFunctions.length > 0 ? specificFunctions : pickFallbackFunction(normalized);
  return {
    functions,
    levelRank: LEVEL_RANK[inferRulesLevel(title)],
  };
}
