import { roleTitleRu, roleTitlesRu, type OwnTitlesRu } from './roleTitleRu';

/**
 * B753 (прод 23.11): знакомому модель писала «открыт к ролям VP of Technology, CTO или COO» — роли
 * из профиля как есть. В запросе к модели роли называются так, как их называет платформа (B737).
 */
const PART_SEPARATOR = /\s*(?:\/|,|;|\||\sили\s|\sor\s)\s*/iu;

/** Английское название роли → русское: роли кампании и части целевой роли профиля. */
export function roleTranslations(
  campaignTitles: readonly string[],
  own: OwnTitlesRu,
  targetRole: string,
): Record<string, string> {
  const parts = targetRole.split(PART_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  return roleTitlesRu([...campaignTitles, targetRole.trim(), ...parts].filter(Boolean), own);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Каждое английское название — одной заменой: длинные первыми, части слов не трогаем. */
export function localizeRoles(text: string, translations: Readonly<Record<string, string>>): string {
  const byKey = new Map(Object.entries(translations).map(([en, ru]) => [en.toLocaleLowerCase('en'), ru]));
  if (byKey.size === 0) return text;
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp(`(?<![\\p{L}\\d])(?:${keys.join('|')})(?![\\p{L}\\d])`, 'giu');
  return text.replace(pattern, (match) => byKey.get(match.toLocaleLowerCase('en')) ?? roleTitleRu(match));
}
