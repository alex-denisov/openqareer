/**
 * Почтовые индексы и коды штатов в строке места (A9, B546, прод 22.10).
 *
 * Indeed и LinkedIn пишут место по-американски: «Chicago, IL», «Honolulu, HI
 * 96813», «Mississauga, ON L4W 5J1», а за пределами США — «Singapore 069542»,
 * «London EC1V 8AB», «〒100-6324 東京都 千代田区». Индекс в названии города
 * делал его неузнаваемым для геокодера и дробил группы оценки зарплаты, а код
 * штата читался как ISO-код страны: на срезе прода 319 мест «…, IL» — все
 * Иллинойс, а не Израиль.
 */

const US_STATES = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ ' +
    'NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'
  ).split(' '),
);
const CA_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));

const US_ZIP = /^\d{5}(?:-\d{4})?$/u;
const CA_POSTAL = /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/u;

/** «IL», «HI 96813», «ON L4W 5J1» → страна; иначе `undefined`. */
export function northAmericanCountryOf(segment: string): 'United States' | 'Canada' | undefined {
  const match = /^([A-Z]{2})(?:\s+(.+))?$/u.exec(segment.trim());
  if (!match) return undefined;
  const [, code, postal] = match;
  if (US_STATES.has(code) && (!postal || US_ZIP.test(postal))) return 'United States';
  if (CA_PROVINCES.has(code) && (!postal || CA_POSTAL.test(postal))) return 'Canada';
  return undefined;
}

/**
 * Хвостовой индекс после названия: британский («EC1V 8AB», «EC1M»), канадский,
 * числовой («069542», «100-6324», «96813»). Индекс обязан содержать цифру,
 * поэтому «Baden-Baden» и «New York» не трогаются.
 */
const TRAILING_POSTAL =
  /\s+(?:[A-Z]{1,2}\d[A-Z\d]?(?:\s?\d[A-Z]{2})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{3,}(?:-\d{2,})?)$/u;
/** Японский индекс впереди: «〒100-6324 東京都». */
const LEADING_POSTAL = /^〒?\s*\d{3}-\d{4}\s+/u;

export function stripPostalCode(label: string): string {
  const stripped = label.trim().replace(LEADING_POSTAL, '').replace(TRAILING_POSTAL, '').trim();
  return stripped || label.trim();
}
