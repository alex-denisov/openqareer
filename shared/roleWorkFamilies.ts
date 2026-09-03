import { canonicalRoleWord } from './roleSynonyms';
import type { WorkFamilyCode } from './workPreferences';

/**
 * К какому виду работы относится роль (B180, срез 3).
 *
 * Таблицу ведёт код, а не модель. Это не удобство, а условие: ответы кандидата
 * на задания меняют **порядок** ролей, и если бы вид работы называла та же
 * модель, что и роль, порядок снова стал бы её мнением — ровно то, что B180
 * запрещает (модель не задаёт порядок).
 *
 * Таблица маленькая и поддерживается руками, как `roleSynonyms.ts`. Роль, для
 * которой вида работы не нашлось, **не отбрасывается и не наказывается** — она
 * просто не двигается ответами кандидата, и продукт может сказать это прямо.
 */
const FAMILY_WORDS: ReadonlyArray<readonly [WorkFamilyCode, readonly string[]]> = [
  [
    'СП',
    ['developer', 'engineer', 'architect', 'programmer', 'devops', 'sre', 'backend',
      'frontend', 'fullstack', 'разработка', 'строитель', 'механик', 'конструктор'],
  ],
  [
    'РР',
    ['analyst', 'analytics', 'data', 'scientist', 'accountant', 'audit', 'finance',
      'financial', 'qa', 'quality', 'researcher', 'экономист', 'аудитор', 'бухгалтерия'],
  ],
  [
    'ПП',
    ['operations', 'operational', 'logistician', 'logistics', 'supply', 'planner',
      'administrator', 'coordinator', 'scheduler', 'project', 'программы', 'снабжение',
      'диспетчер', 'администратор'],
  ],
  [
    'ЛД',
    ['sales', 'salesperson', 'account', 'partnership', 'business development',
      'procurement', 'buyer', 'negotiator', 'закупки', 'продажи', 'клиентский'],
  ],
  [
    'ЗО',
    ['support', 'teacher', 'tutor', 'nurse', 'doctor', 'recruiter', 'hr', 'people',
      'care', 'наставник', 'преподаватель', 'медсестра', 'воспитатель'],
  ],
  [
    'ЗФ',
    ['designer', 'design', 'content', 'copywriter', 'marketer', 'marketing', 'brand',
      'creative', 'редактор', 'художник', 'оператор съёмки'],
  ],
  [
    'НН',
    ['product', 'strategy', 'strategist', 'discovery', 'founder', 'venture',
      'innovation', 'стратегия', 'исследование рынка'],
  ],
  [
    'РМ',
    ['driver', 'cook', 'technician', 'installer', 'welder', 'operator', 'warehouse',
      'field', 'мастер', 'монтажник', 'сварщик', 'повар', 'кладовщик', 'слесарь'],
  ],
];

/**
 * `null` — законный ответ: он означает «эту роль таблица не знает», а не
 * «роль плохая». Догадка здесь дороже незнания: неверный вид работы двигал бы
 * роль в порядке по чужим ответам.
 */
export function roleWorkFamily(title: string): WorkFamilyCode | null {
  const words = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean)
    .map(canonicalRoleWord);
  const haystack = `${title.toLowerCase()} ${words.join(' ')}`;
  for (const [family, needles] of FAMILY_WORDS) {
    if (needles.some((needle) => haystack.includes(needle))) return family;
  }
  return null;
}
