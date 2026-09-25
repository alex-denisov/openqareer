import { ROLE_TAXONOMY, type FunctionCode } from '../../../shared/roleTaxonomy';
import { LEVEL_RANK, inferSeniorityLevel } from '../levelMatcher';

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
  const functions = pickTopFunctions(hits);
  const level = inferSeniorityLevel(title);
  return {
    functions,
    levelRank: level ? LEVEL_RANK[level] : null,
  };
}
