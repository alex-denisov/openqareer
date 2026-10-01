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

const ADDITIONAL_ANCHORS: readonly AnchorHit[] = [
  // it-ops
  { code: 'it-ops', anchor: 'it manager' },
  { code: 'it-ops', anchor: 'it director' },
  { code: 'it-ops', anchor: 'it portfolio leader' },
  { code: 'it-ops', anchor: 'it portfolio' },
  { code: 'it-ops', anchor: 'it operations manager' },
  { code: 'it-ops', anchor: 'it operations' },
  { code: 'it-ops', anchor: 'it infrastructure' },
  { code: 'it-ops', anchor: 'it support' },
  { code: 'it-ops', anchor: 'it solution delivery executive' },
  { code: 'it-ops', anchor: 'head of it' },
  { code: 'it-ops', anchor: 'head of global technology services' },
  { code: 'it-ops', anchor: 'head of corporate applications' },
  { code: 'it-ops', anchor: 'head of employee tech' },
  { code: 'it-ops', anchor: 'information systems manager' },
  { code: 'it-ops', anchor: 'director, global it' },
  { code: 'it-ops', anchor: 'global it' },
  { code: 'it-ops', anchor: 'technology operations' },
  { code: 'it-ops', anchor: 'hardware deployment' },
  { code: 'it-ops', anchor: 'technical success management' },
  { code: 'it-ops', anchor: 'technical consulting' },
  { code: 'it-ops', anchor: 'data centers' },
  { code: 'it-ops', anchor: 'infrastructure' },
  { code: 'it-ops', anchor: 'директор по информационным технологиям' },
  { code: 'it-ops', anchor: 'директор по ит' },
  { code: 'it-ops', anchor: 'ит-директор' },
  { code: 'it-ops', anchor: 'ит директор' },
  { code: 'it-ops', anchor: 'руководитель отдела ит' },
  { code: 'it-ops', anchor: 'руководитель отдела it' },
  { code: 'it-ops', anchor: 'начальник отдела ит' },
  { code: 'it-ops', anchor: 'начальник it отдела' },
  { code: 'it-ops', anchor: 'руководитель ит отдела' },
  { code: 'it-ops', anchor: 'руководитель it отдела' },
  { code: 'it-ops', anchor: 'ит лидер' },
  { code: 'it-ops', anchor: 'начальник отдела эксплуатации' },
  { code: 'it-ops', anchor: 'руководитель отдела эксплуатации' },
  { code: 'it-ops', anchor: 'эксплуатации ис' },
  { code: 'it-ops', anchor: 'эксплуатации информационных систем' },
  { code: 'it-ops', anchor: 'руководитель сетевого отдела' },
  { code: 'it-ops', anchor: 'сетевого отдела' },
  { code: 'it-ops', anchor: 'начальник отдела телекоммуникаций' },
  { code: 'it-ops', anchor: 'руководитель отдела системного администрирования' },
  { code: 'it-ops', anchor: 'начальник компьютерного обеспечения' },
  { code: 'it-ops', anchor: 'комплексов связи' },
  { code: 'it-ops', anchor: 'системного администрирования' },
  { code: 'it-ops', anchor: 'служба асу' },
  { code: 'it-ops', anchor: 'службы асу' },
  { code: 'it-ops', anchor: '1с' },
  { code: 'it-ops', anchor: 'cio' },

  // eng-mgmt & tech leadership
  { code: 'eng-mgmt', anchor: 'cloud engineering' },
  { code: 'eng-mgmt', anchor: 'digital transformation' },
  { code: 'eng-mgmt', anchor: 'head of digital transformation' },
  { code: 'eng-mgmt', anchor: 'cdo' },
  { code: 'eng-mgmt', anchor: 'cto' },
  { code: 'eng-mgmt', anchor: 'cpto' },
  { code: 'eng-mgmt', anchor: 'ciso' },
  { code: 'eng-mgmt', anchor: 'founding cto' },
  { code: 'eng-mgmt', anchor: 'solution architects' },
  { code: 'eng-mgmt', anchor: 'solutions architects' },
  { code: 'eng-mgmt', anchor: 'client solution architects' },
  { code: 'eng-mgmt', anchor: 'vice president, client solution architects' },
  { code: 'eng-mgmt', anchor: 'digital officer' },
  { code: 'eng-mgmt', anchor: 'chief of staff, engineering' },
  { code: 'eng-mgmt', anchor: 'avp, engineering & qa' },
  { code: 'eng-mgmt', anchor: 'head of development' },
  { code: 'eng-mgmt', anchor: 'software engineering' },
  { code: 'eng-mgmt', anchor: 'software development' },
  { code: 'eng-mgmt', anchor: 'director of technology' },
  { code: 'eng-mgmt', anchor: 'executive director of technology' },
  { code: 'eng-mgmt', anchor: 'vice president of technology' },
  { code: 'eng-mgmt', anchor: 'ad tech engineering' },
  { code: 'eng-mgmt', anchor: 'analytics platform' },
  { code: 'eng-mgmt', anchor: 'commercial platforms' },
  { code: 'eng-mgmt', anchor: 'security operations & engineering' },
  { code: 'eng-mgmt', anchor: 'gestion technologique' },
  { code: 'eng-mgmt', anchor: 'knowledge engineer' },
  { code: 'eng-mgmt', anchor: 'bess r&d and engineering' },
  { code: 'eng-mgmt', anchor: 'ai engineer' },
  { code: 'eng-mgmt', anchor: 'machine learning engineering' },
  { code: 'eng-mgmt', anchor: 'data engineering' },
  { code: 'eng-mgmt', anchor: 'data strategy' },
  { code: 'eng-mgmt', anchor: 'shopify engineering' },
  { code: 'eng-mgmt', anchor: 'capacity engineering' },
  { code: 'eng-mgmt', anchor: 'mobile engineering' },
  { code: 'eng-mgmt', anchor: 'process design engineering' },
  { code: 'eng-mgmt', anchor: 'system co-design' },
  { code: 'eng-mgmt', anchor: 'solution operations' },
  { code: 'eng-mgmt', anchor: 'solutions technology' },
  { code: 'eng-mgmt', anchor: 'hardware manager' },
  { code: 'eng-mgmt', anchor: 'electrical and mechanical director' },
  { code: 'eng-mgmt', anchor: 'software applications and support' },
  { code: 'eng-mgmt', anchor: 'maintenance manager- projects' },
  { code: 'eng-mgmt', anchor: 'psoc manager' },
  { code: 'eng-mgmt', anchor: 'директор по разработке' },
  { code: 'eng-mgmt', anchor: 'руководитель разработки' },
  { code: 'eng-mgmt', anchor: 'руководитель отдела разработки' },
  { code: 'eng-mgmt', anchor: 'директор по техническому развитию' },
  { code: 'eng-mgmt', anchor: 'технический директор' },
  { code: 'eng-mgmt', anchor: 'заместитель технического директора' },
  { code: 'eng-mgmt', anchor: 'техлид' },
  { code: 'eng-mgmt', anchor: 'руководитель технического отдела' },
  { code: 'eng-mgmt', anchor: 'руководитель технической службы' },
  { code: 'eng-mgmt', anchor: 'руководитель технической функции' },
  { code: 'eng-mgmt', anchor: 'руководитель отдела автоматизации' },
  { code: 'eng-mgmt', anchor: 'отдела автоматизации' },
  { code: 'eng-mgmt', anchor: 'руководитель отдела внедрения' },
  { code: 'eng-mgmt', anchor: 'бюро внедрения' },
  { code: 'eng-mgmt', anchor: 'инженерно-технического отдела' },
  { code: 'eng-mgmt', anchor: 'инжинирингового центра' },
  { code: 'eng-mgmt', anchor: 'технического департамента' },
  { code: 'eng-mgmt', anchor: 'руководитель филиала ит-компании' },
  { code: 'eng-mgmt', anchor: 'подписочных приложений' },
  { code: 'eng-mgmt', anchor: 'saas' },
  { code: 'eng-mgmt', anchor: 'it-компании' },

  // exec-general
  { code: 'exec-general', anchor: 'senior director' },
  { code: 'exec-general', anchor: 'sr. director' },
  { code: 'exec-general', anchor: 'executive director' },
  { code: 'exec-general', anchor: 'regional director' },
  { code: 'exec-general', anchor: 'regional business director' },
  { code: 'exec-general', anchor: 'board of directors' },

  // Non-IT sector anchors for filtering noise out of exec-general (§3.5)
  { code: 'healthcare', anchor: 'медицинского центра' },
  { code: 'healthcare', anchor: 'медицинский центр' },
  { code: 'healthcare', anchor: 'медицинск' },
  { code: 'healthcare', anchor: 'клиника' },
  { code: 'healthcare', anchor: 'клиники' },
  { code: 'healthcare', anchor: 'главврач' },
  { code: 'healthcare', anchor: 'главный врач' },
  { code: 'healthcare', anchor: 'стоматолог' },
  { code: 'healthcare', anchor: 'больница' },
  { code: 'healthcare', anchor: 'аптека' },
  { code: 'healthcare', anchor: 'фармацевтической' },

  { code: 'hospitality', anchor: 'ресторанной франшизой' },
  { code: 'hospitality', anchor: 'ресторанной' },
  { code: 'hospitality', anchor: 'ресторан' },
  { code: 'hospitality', anchor: 'ресторана' },
  { code: 'hospitality', anchor: 'общепит' },
  { code: 'hospitality', anchor: 'шеф-повар' },
  { code: 'hospitality', anchor: 'кафе' },
  { code: 'hospitality', anchor: 'тревел' },
  { code: 'hospitality', anchor: 'travel' },

  { code: 'retail', anchor: 'chief of merchandising' },
  { code: 'retail', anchor: 'merchandising' },
  { code: 'retail', anchor: 'ритейл' },
  { code: 'retail', anchor: 'супермаркет' },
  { code: 'retail', anchor: 'торговая сеть' },
  { code: 'retail', anchor: 'торговой сети' },
  { code: 'retail', anchor: 'магазинов' },
  { code: 'retail', anchor: 'магазина' },
  { code: 'retail', anchor: 'магазин' },
  { code: 'retail', anchor: 'магнит у дома' },
  { code: 'retail', anchor: 'магнит' },

  { code: 'education', anchor: 'детским образовательным' },
  { code: 'education', anchor: 'образовательным учреждением' },
  { code: 'education', anchor: 'детского развивающего центра' },
  { code: 'education', anchor: 'дополнительного образования' },
  { code: 'education', anchor: 'детский сад' },
  { code: 'education', anchor: 'школы' },
  { code: 'education', anchor: 'школа' },
  { code: 'education', anchor: 'сферы образования' },
  { code: 'education', anchor: 'я расту' },
  { code: 'education', anchor: 'pastor' },
  { code: 'education', anchor: 'ministries' },

  { code: 'logistics', anchor: 'эксплуатации трубопроводов' },
  { code: 'logistics', anchor: 'трубопроводов' },
  { code: 'logistics', anchor: 'автосервис' },
  { code: 'logistics', anchor: 'автосервиса' },
  { code: 'logistics', anchor: 'автопредприятия' },
  { code: 'logistics', anchor: 'таксопарка' },
  { code: 'logistics', anchor: 'транспортной компании' },
  { code: 'logistics', anchor: 'транспортной' },
  { code: 'logistics', anchor: 'транспорт' },
  { code: 'logistics', anchor: 'складских процессов' },
  { code: 'logistics', anchor: 'склад' },
  { code: 'logistics', anchor: 'материально-технического обеспечения' },

  { code: 'manufacturing', anchor: 'в типографию' },
  { code: 'manufacturing', anchor: 'типография' },
  { code: 'manufacturing', anchor: 'типографии' },
  { code: 'manufacturing', anchor: 'электроцеха' },
  { code: 'manufacturing', anchor: 'электрического цеха' },
  { code: 'manufacturing', anchor: 'энергоцентра' },
  { code: 'manufacturing', anchor: 'энергоучастка' },
  { code: 'manufacturing', anchor: 'на производство' },
  { code: 'manufacturing', anchor: 'производства' },
  { code: 'manufacturing', anchor: 'конструкторского бюро' },
  { code: 'manufacturing', anchor: 'конструкторское бюро' },
  { code: 'manufacturing', anchor: 'электротехнической лаборатории' },
  { code: 'manufacturing', anchor: 'электролаборатории' },
  { code: 'manufacturing', anchor: 'лаборатории' },
  { code: 'manufacturing', anchor: 'атомного' },
  { code: 'manufacturing', anchor: 'по ремонту' },
  { code: 'manufacturing', anchor: 'ремонту' },
  { code: 'manufacturing', anchor: 'котельной' },
  { code: 'manufacturing', anchor: 'электростанции' },
  { code: 'manufacturing', anchor: 'энергомеханического' },
  { code: 'manufacturing', anchor: 'промышленной электроники' },
  { code: 'manufacturing', anchor: 'бетон' },
  { code: 'manufacturing', anchor: 'чоо' },
  { code: 'manufacturing', anchor: 'beskyttelse' },
  { code: 'manufacturing', anchor: 'cymer' },
  { code: 'manufacturing', anchor: 'int-' },
  { code: 'manufacturing', anchor: 'gd9' },

  { code: 'construction', anchor: 'проектирования электромонтажа' },
  { code: 'construction', anchor: 'электромонтажа' },
  { code: 'construction', anchor: 'строительства' },
  { code: 'construction', anchor: 'строительного' },
  { code: 'construction', anchor: 'монтажного отдела' },

  { code: 'agriculture', anchor: 'сельхозпредприятия' },
  { code: 'agriculture', anchor: 'сельхоз' },

  { code: 'marketing', anchor: 'рекламного агентства' },

  { code: 'real-estate', anchor: 'агентства недвижимости' },
  { code: 'real-estate', anchor: 'натяжным потолкам' },
  { code: 'real-estate', anchor: 'управляющей компании жкх' },

  { code: 'other', anchor: 'директор агентства' },
  { code: 'other', anchor: 'охранного предприятия' },
  { code: 'other', anchor: 'пневматического тира' },
  { code: 'other', anchor: 'спортивного' },
  { code: 'other', anchor: 'культурно-досугового' },
  { code: 'other', anchor: 'досугового' },
  { code: 'other', anchor: 'board chair' },
  { code: 'other', anchor: 'sustainability' },
];

const ANCHOR_MATCHERS: readonly AnchorMatcher[] = [
  ...ROLE_TAXONOMY.flatMap((definition) =>
    definition.anchors.map((anchor) => ({ code: definition.code, anchor })),
  ),
  ...ADDITIONAL_ANCHORS,
].map((hit) => {
  const compactLatin = COMPACT_CJK_LATIN_ANCHORS.has(hit.anchor);
  return {
    code: hit.code,
    anchor: hit.anchor,
    compactPattern: compactLatin ? new RegExp(`(?<![a-z])${hit.anchor}(?![a-z])`, 'u') : null,
    pattern: CJK_SCRIPT.test(hit.anchor)
      ? null
      : new RegExp(`(?<![\\p{L}])${escapeRegExp(hit.anchor)}(?![\\p{L}])`, 'u'),
  };
});

function matchesAnchor(
  normalizedTitle: string,
  matcher: AnchorMatcher,
  compactTitle: boolean,
): boolean {
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

/**
 * Точное совпадение с вариантом — одна функция роли, если название не составное. Частичное совпадение
 * внутри составного названия («VP of Technology & Operations» → роль
 * `ops.vp`) дополняется функциями опорных слов: иначе вторая половина
 * названия терялась (B267 S3, 26.09). Не больше двух функций.
 */
function ontologyFunctions(
  variant: OntologyVariant,
  normalizedKey: string,
  normalizedTitle: string,
): FunctionCode[] {
  const compound = COMPOUND_TITLE.test(normalizedTitle);
  if (ONTOLOGY_VARIANTS.exact.has(normalizedKey) && !compound) return [variant.function];
  const anchorFunctions = pickTopFunctions(findAnchorHits(normalizedTitle));
  return [...new Set([variant.function, ...anchorFunctions])].slice(0, 2);
}

/** Составное название: две роли через союз — функции обеих половин. */
const COMPOUND_TITLE = /\s(?:&|and|и)\s|\//u;

function levelRankForOntologyRole(title: string, variant: OntologyVariant): number {
  if (!hasRulesLevelMarker(title) && variant.levels.length === 1)
    return LEVEL_RANK[variant.levels[0]];
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
      'manager',
      'director',
      'specialist',
      'analyst',
      'coordinator',
      'supervisor',
      'associate',
      'executive',
      'lead',
      'expert',
      'administrator',
      'representative',
      'consultant',
      'intern',
      'apprentice',
      'partner',
      'officer',
      'staff',
      'agent',
      'clerk',
      'driver',
      'guide',
      'buyer',
      'strategist',
      'principal',
      'leader',
      'processor',
      'trainee',
      'apprenticeship',
      'ejecutivo',
      'ejecutiva',
      'especialista',
      'gerente',
      'diretor',
      'directora',
      'executivo',
      'executiva',
      'vendedor',
      'vendedora',
      'consultor',
      'consultora',
      'analista',
      'coordenador',
      'coordenadora',
      'responsable',
      'ingeniero',
      'responsavel',
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
    const specificity = CJK_SCRIPT.test(hit.anchor)
      ? hit.anchor.length
      : hit.anchor.split(' ').length;
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
  const normalized = ` ${title.toLowerCase()} `;
  if (ontologyVariant) {
    return {
      functions: ontologyFunctions(ontologyVariant, normalizedKey, normalized),
      levelRank: levelRankForOntologyRole(title, ontologyVariant),
      roleId: ontologyVariant.roleId,
    };
  }
  const hits = findAnchorHits(normalized);
  const specificFunctions = pickTopFunctions(hits);
  const functions =
    specificFunctions.length > 0 ? specificFunctions : pickFallbackFunction(normalized);
  return {
    functions,
    levelRank: LEVEL_RANK[inferRulesLevel(title)],
  };
}
