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

/**
 * Заголовок нормализуется до нижнего регистра и границ по не-буквам, чтобы
 * якорь «vp sales» не совпал внутри «vp salesforce».
 */
function findAnchorHits(normalizedTitle: string): AnchorHit[] {
  const hits: AnchorHit[] = [];
  for (const definition of ROLE_TAXONOMY) {
    for (const anchor of definition.anchors) {
      const pattern = new RegExp(`(?<![\\p{L}])${escapeRegExp(anchor)}(?![\\p{L}])`, 'u');
      if (pattern.test(normalizedTitle)) {
        hits.push({ code: definition.code, anchor });
      }
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
    const wordCount = hit.anchor.split(' ').length;
    const current = bestByCode.get(hit.code) ?? 0;
    if (wordCount > current) bestByCode.set(hit.code, wordCount);
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
