import { ROLE_TAXONOMY, type FunctionCode } from '../../../shared/roleTaxonomy';
import { ontology, type OntologyLevel } from '../../../shared/roleOntology';
import { LEVEL_RANK } from '../levelMatcher';
import { hasRulesLevelMarker, inferRulesLevel } from './rulesLevel';
import { normalizeTitleKey } from './normalizeTitleKey';

/**
 * Фолбэк без модели (B267 §3): опорные слова словаря дают функцию, уже
 * существующий `inferSeniorityLevel` — уровень. Если модели недоступны,
 * подбор работает целиком на правилах — хуже, но честно, без добивки.
 */
export interface RulesParseResult {
  readonly functions: readonly FunctionCode[];
  readonly levelRank: number | null;
  readonly roleId?: string;
}

interface OntologyVariant {
  readonly function: FunctionCode;
  readonly levels: readonly OntologyLevel[];
  readonly roleId: string;
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

function createOntologyVariantIndex(): Readonly<{
  readonly exact: ReadonlyMap<string, OntologyVariant>;
  readonly multiWord: ReadonlyMap<string, OntologyVariant>;
}> {
  const exact = new Map<string, OntologyVariant>();
  const multiWord = new Map<string, OntologyVariant>();
  for (const role of ontology.roles) {
    for (const variant of [...role.variants.en, ...role.variants.ru]) {
      const normalized = normalizeTitleKey(variant);
      if (!normalized) continue;
      const parts = normalized.split(/\s+/u);
      const entry = Object.freeze({
        function: role.function as FunctionCode,
        levels: role.levels as readonly OntologyLevel[],
        roleId: role.id,
      });
      if (!exact.has(normalized)) exact.set(normalized, entry);
      if (parts.length < 2) continue;
      const phrase = wordsFromTitle(normalized).join(' ');
      if (phrase) multiWord.set(phrase, multiWord.get(phrase) ?? entry);
    }
  }
  return Object.freeze({ exact, multiWord });
}

const ONTOLOGY_VARIANTS = createOntologyVariantIndex();

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

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

function wordsFromTitle(normalizedTitle: string): readonly string[] {
  return normalizedTitle.match(/\p{L}+/gu) ?? [];
}

function findOntologyVariant(normalizedTitle: string): OntologyVariant | undefined {
  const exact = ONTOLOGY_VARIANTS.exact.get(normalizedTitle);
  if (exact) return exact;
  const words = wordsFromTitle(normalizedTitle);
  for (let length = words.length; length >= 2; length -= 1) {
    for (let start = 0; start <= words.length - length; start += 1) {
      const entry = ONTOLOGY_VARIANTS.multiWord.get(words.slice(start, start + length).join(' '));
      if (entry) return entry;
    }
  }
  return undefined;
}

function levelRankForOntologyRole(title: string, variant: OntologyVariant): number {
  if (!hasRulesLevelMarker(title) && variant.levels.length === 1) return LEVEL_RANK[variant.levels[0]];
  return LEVEL_RANK[inferRulesLevel(title)];
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
  const normalizedKey = normalizeTitleKey(title);
  const ontologyVariant = findOntologyVariant(normalizedKey);
  if (ontologyVariant) {
    return {
      functions: [ontologyVariant.function],
      levelRank: levelRankForOntologyRole(title, ontologyVariant),
      roleId: ontologyVariant.roleId,
    };
  }
  const normalized = ` ${title.toLowerCase()} `;
  const hits = findAnchorHits(normalized);
  const specificFunctions = pickTopFunctions(hits);
  const functions = specificFunctions.length > 0 ? specificFunctions : pickFallbackFunction(normalized);
  return {
    functions,
    levelRank: LEVEL_RANK[inferRulesLevel(title)],
  };
}
