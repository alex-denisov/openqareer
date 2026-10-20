/**
 * B540: how many people a vacancy asks the candidate to lead, read from its
 * text. Only an explicit threshold next to a word for people counts — «от 50
 * человек», «из 40+ разработчиков», «teams of 50+ engineers» — so years,
 * salaries and other figures never turn into a team requirement.
 */
const PEOPLE_RU =
  '(?:человек|чел\\.|инженер\\p{L}*|разработчик\\p{L}*|сотрудник\\p{L}*|специалист\\p{L}*)';
const PEOPLE_EN = '(?:people|engineers|developers|employees|reports|staff)';
const THRESHOLD_RU = '(?:от|из|более|свыше|не\\s+менее)';
const THRESHOLD_EN = '(?:of|over|more\\s+than|at\\s+least)';

const TEAM_SIZE_PATTERNS = [
  new RegExp(`${THRESHOLD_RU}\\s+(\\d{1,5})\\s*\\+?\\s*${PEOPLE_RU}`, 'giu'),
  new RegExp(`${THRESHOLD_EN}\\s+(\\d{1,5})\\s*\\+?\\s*${PEOPLE_EN}`, 'giu'),
  new RegExp(`(\\d{1,5})\\s*\\+\\s*(?:${PEOPLE_RU}|${PEOPLE_EN})`, 'giu'),
] as const;

export function teamSizeRequirement(text: string): number | null {
  const sizes = TEAM_SIZE_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => Number(match[1])),
  ).filter((size) => Number.isInteger(size) && size >= 2);
  return sizes.length ? Math.min(...sizes) : null;
}
