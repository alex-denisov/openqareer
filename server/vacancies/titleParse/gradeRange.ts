/**
 * Грейд специалиста по слову в названии (этап 1 качества подбора, 04.11).
 *
 * 78 % названий лежат на одной ступени `ic`: Junior и Senior там неразличимы. Шкала `LEVEL_RANK`
 * остаётся контрактом подбора, а этот диапазон уточняет только её нижние ступени. Диапазоны соседних
 * грейдов пересекаются: это мягкая граница, а не жёсткий фильтр. Название без слова диапазона не
 * имеет и подбор не сужает: у 77 % названий ступени `ic` такого слова нет (замер на проде 04.11).
 */
export interface GradeRange {
  readonly min: number;
  readonly max: number;
}

const word = (pattern: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu');

const GRADES: readonly { readonly pattern: RegExp; readonly range: GradeRange }[] = [
  {
    pattern: word(
      'junior|jr\\.?|intern|trainee|entry[- ]level|младш\\p{L}*|помощник\\p{L}*|стаж[её]р\\p{L}*|начинающ\\p{L}*',
    ),
    range: { min: 0, max: 2 },
  },
  { pattern: word('middle(?! (?:east|office))|mid[- ]level|мидл'), range: { min: 1, max: 3 } },
  { pattern: word('senior|sr\\.?|старш\\p{L}*'), range: { min: 3, max: 5 } },
  { pattern: word('lead(?! gen)|principal|ведущ\\p{L}*'), range: { min: 3, max: 6 } },
  { pattern: word('главн\\p{L}*'), range: { min: 4, max: 7 } },
];

/** Диапазон названия: «Junior/Middle» — оба слова вместе. `null` — слова грейда нет. */
export function gradeRangeOfTitle(title: string): GradeRange | null {
  const found = GRADES.filter(({ pattern }) => pattern.test(title)).map(({ range }) => range);
  if (found.length === 0) return null;
  return {
    min: Math.min(...found.map((range) => range.min)),
    max: Math.max(...found.map((range) => range.max)),
  };
}

function unionOf(titles: readonly string[]): GradeRange | null {
  const ranges = titles.flatMap((title) => gradeRangeOfTitle(title) ?? []);
  if (ranges.length === 0) return null;
  return {
    min: Math.min(...ranges.map((range) => range.min)),
    max: Math.max(...ranges.map((range) => range.max)),
  };
}

/** Старая должность окно не сужает и не размывает: важны последние места. */
const RECENT_PLACES = 2;

/**
 * Диапазон кандидата: слово в целевых ролях, иначе в последних местах работы. `null` — слова нет
 * нигде, и подбор идёт как раньше: придумывать кандидату грейд незачем.
 */
export function candidateGradeRange(input: {
  readonly targetRoles: readonly string[];
  readonly recentTitles: readonly string[];
}): GradeRange | null {
  return unionOf(input.targetRoles) ?? unionOf(input.recentTitles.slice(0, RECENT_PLACES));
}
