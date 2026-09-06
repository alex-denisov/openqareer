/**
 * Политика публичных адресов (B209).
 *
 * Владелец задал правило дословно: «Только естественный чистый английский
 * семантический URL… Транслитерация строго запрещена, за исключением исконно
 * российских реалий/программных продуктов без английского эквивалента
 * (например /vacancies/moscow/programmist-1c)».
 *
 * Правило проверяется машиной, а не памятью агента: сборка роняется, если
 * хотя бы один адрес из `sitemap.xml` его нарушает. Транслит ловится двумя
 * независимыми способами — словарём корней и диграфами, которых в английском
 * не бывает, — потому что один словарь всегда отстаёт от новых страниц.
 */

/** Сегмент адреса: строчная латиница и цифры, разделитель — дефис. */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Диграфы, которые в английских словах не встречаются, а в транслите русского
 * появляются постоянно. Держим только безошибочные: `kh` отброшен намеренно
 * («khaki»), ложное срабатывание дороже пропуска.
 */
const TRANSLITERATED_DIGRAPHS = ['zh', 'shch'] as const;

/**
 * Корни транслитерированных русских слов, которые вероятнее всего окажутся в
 * адресе работного продукта. Список пополняется, когда ловится новый случай.
 */
const TRANSLITERATED_ROOTS = [
  'vakans',
  'rabot',
  'moskv',
  'piter',
  'sankt',
  'razrabotchik',
  'programmist',
  'analitik',
  'interfeis',
  'kompan',
  'rezyum',
  'rezume',
  'poisk',
  'sotrudnik',
  'dolzhnost',
  'zarplat',
  'udalenk',
  'karer',
  'nachalnik',
  'stazhirovk',
  'obuchen',
  'gorod',
  'strana',
  'navyk',
  'opyt',
] as const;

/** Сегмент про российский программный продукт — исключение, данное владельцем. */
function isRussianSoftwareProduct(segment: string): boolean {
  return segment.split('-').includes('1c');
}

/**
 * Похож ли сегмент на транслит русского слова. Исключение для 1С здесь не
 * применяется: вызывающий решает сам, действует ли оно для этого сегмента.
 */
export function isTransliteratedSegment(segment: string): boolean {
  if (TRANSLITERATED_DIGRAPHS.some((digraph) => segment.includes(digraph))) return true;
  return segment
    .split('-')
    .some((token) => TRANSLITERATED_ROOTS.some((root) => token.startsWith(root)));
}

/**
 * Причина, по которой адрес нарушает политику, или `null`, если он ей отвечает.
 * Причина сформулирована словами, чтобы упавшая сборка называла виновника.
 */
export function publicPathViolation(path: string): string | null {
  if (!path.startsWith('/')) return `адрес «${path}» не начинается со слэша`;
  if (path === '/') return null;

  const segments = path.replace(/\/$/u, '').split('/').slice(1);
  for (const segment of segments) {
    if (segment.length === 0) return `адрес «${path}» содержит пустой сегмент`;
    if (!SEGMENT.test(segment)) {
      return `сегмент «${segment}» — не строчная латиница через дефис`;
    }
    if (isRussianSoftwareProduct(segment)) continue;
    if (isTransliteratedSegment(segment)) {
      return `сегмент «${segment}» выглядит транслитом русского слова`;
    }
  }
  return null;
}

/** Отвечает ли публичный адрес политике владельца. */
export function isValidPublicPath(path: string): boolean {
  return publicPathViolation(path) === null;
}
