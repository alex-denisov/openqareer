import type { VacancyRoleMatch } from '../../shared/vacancyMatchOrder';
import { normalizeTextForComparison } from './vacancyFingerprint';

/**
 * Третья точка соответствия рядом с ролью и гео (B248, разрыв «Вакансии»):
 * уровень роли кандидата против уровня вакансии. Пять ступеней — IC, лид,
 * руководитель направления (head), VP, C-level — те же, что макет показывает
 * фильтром «уровень».
 */
export type SeniorityLevel = 'ic' | 'lead' | 'head' | 'vp' | 'c-level';

const LEVEL_RANK: Record<SeniorityLevel, number> = {
  ic: 0,
  lead: 1,
  head: 2,
  vp: 3,
  'c-level': 4,
};

/**
 * Порядок важен: «C-level» проверяется раньше «lead», иначе «Chief Product
 * Officer» подхватило бы менее специфичное правило первым не бывает здесь,
 * но правило head проверяется после lead, чтобы «tech lead» не читалось как
 * head через слово «lead» внутри «leadership».
 */
const LEVEL_MARKERS: readonly { readonly level: SeniorityLevel; readonly markers: readonly string[] }[] = [
  {
    level: 'c-level',
    markers: [
      'chief',
      'cto',
      'cpo',
      'ceo',
      'coo',
      'cfo',
      'cmo',
      'gendirector',
      'генеральный директор',
    ],
  },
  {
    level: 'vp',
    markers: ['vice president', 'vice-president', 'vp of', 'vp,', ' vp ', 'вице-президент'],
  },
  {
    level: 'head',
    markers: ['head of', 'head,', ' head ', 'director', 'руководитель отдела', 'руководитель направления', 'директор'],
  },
  {
    level: 'lead',
    markers: ['tech lead', 'team lead', 'lead ', 'lead,', 'тимлид', 'тим-лид'],
  },
  {
    level: 'ic',
    markers: [
      'senior',
      'junior',
      'middle',
      'individual contributor',
      'старший',
      'младший',
      'ведущий',
    ],
  },
];

/**
 * Уровень из заголовка вакансии. `undefined` — заголовок не назвал уровень:
 * fit-dot «уровень» в этом случае не рисуется, а не подставляет IC по
 * умолчанию (PRB-016 — соответствие не выдумывается из отсутствия данных).
 */
export function inferSeniorityLevel(title: string): SeniorityLevel | undefined {
  const norm = ` ${normalizeTextForComparison(title)} `;
  for (const { level, markers } of LEVEL_MARKERS) {
    if (markers.some((marker) => norm.includes(marker))) {
      return level;
    }
  }
  return undefined;
}

/**
 * Совпадение переиспользует шкалу роль-матча (`target`/`partial`/`none`):
 * один и тот же fit-dot-словарь на экране, один шаг лестницы — partial, два и
 * больше — none.
 */
export function evaluateLevelMatch(
  candidateLevel: SeniorityLevel | undefined,
  vacancyTitle: string,
): VacancyRoleMatch | undefined {
  if (!candidateLevel) return undefined;
  const vacancyLevel = inferSeniorityLevel(vacancyTitle);
  if (!vacancyLevel) return undefined;

  const distance = Math.abs(LEVEL_RANK[candidateLevel] - LEVEL_RANK[vacancyLevel]);
  if (distance === 0) return 'target';
  if (distance === 1) return 'partial';
  return 'none';
}
