/**
 * How many people the candidate led in one workplace, read from that
 * workplace's own text: «команда из 6 человек», «8 человек кросфункциональная
 * команда», «team of 9 IT engineers». Only a number next to a word for people
 * counts, so years, percentages, budgets and SKU counts never become a team.
 */
const PEOPLE =
  '(?:человек\\p{L}*|чел\\.|сотрудник\\p{L}*|разработчик\\p{L}*|инженер\\p{L}*|специалист\\p{L}*|' +
  'подчин[её]нн\\p{L}*|people|engineers?|developers?|employees|reports|staff|members)';

const PATTERNS = [
  new RegExp(`(?<![\\p{N}.,])(\\d{1,4})\\s*\\+?\\s*${PEOPLE}(?![\\p{L}])`, 'giu'),
  /\bteams?\s+of\s+(\d{1,4})\b/giu,
] as const;

export function teamSizeFromWorkplaceText(text: string): number | null {
  const sizes = PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => Number(match[1])),
  ).filter((size) => Number.isInteger(size) && size >= 2 && size <= 10_000);
  return sizes.length ? Math.max(...sizes) : null;
}
