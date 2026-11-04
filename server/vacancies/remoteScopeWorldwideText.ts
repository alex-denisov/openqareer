/**
 * Текст, открывающий удалёнку на весь мир, главнее поля места (04.11, Xapo:
 * «Remote - Work from Anywhere» при месте «Gibraltar»; поле у Himalayas часто
 * называет страну найма, а не ограничение).
 *
 * Просто «work from anywhere» в описании такой пометкой не считается: на проде
 * это и «Work Anywhere company» (офис или дом по выбору), и «60 days per year»,
 * и «the Work from Anywhere era». Поэтому в описании берём только фразы о
 * месте работы и начало текста, а название — целиком.
 */
const NOT_A_PLACE_LIMIT = String.raw`(?!\s+(?:in|within|across|outside|inside|on|for|up|opportunity|options?|days?|policy|era|program)\b)`;

const WORK_FROM_ANYWHERE = String.raw`work(?:ing)?\s+from\s+anywhere${NOT_A_PLACE_LIMIT}`;

const TITLE_MARK = new RegExp(
  String.raw`(?<!\p{L})(?:${WORK_FROM_ANYWHERE}|remote\s*[-–—(,]?\s*anywhere${NOT_A_PLACE_LIMIT}|anywhere\s+remote)`,
  'iu',
);

const OPENING_LENGTH = 40;
const OPENING_MARK = new RegExp(String.raw`^\W*${WORK_FROM_ANYWHERE}`, 'iu');

const DESCRIPTION_MARKS: readonly RegExp[] = [
  // «Location: Remote (Work from Anywhere)»
  new RegExp(
    String.raw`(?<!\p{L})location\s*[:–—-]\s*(?:fully\s+|100%\s+)?remote\s*[-–—,(]*\s*${WORK_FROM_ANYWHERE}`,
    'iu',
  ),
  // «100% Remote Role (Work from anywhere)»
  new RegExp(
    String.raw`(?<!\p{L})remote\s+(?:role|position|job)\s*[-–—,(]+\s*${WORK_FROM_ANYWHERE}`,
    'iu',
  ),
  // «This 100% remote position allows you to work anywhere»
  /(?<!\p{L})this\s+(?:is\s+a\s+)?(?:(?:100%|fully|permanent)\s+)?remote\s+(?:role|position|job)?[^.\n]{0,40}\bwork\s+(?:from\s+)?anywhere(?!\s+(?:in|within|across)\b)/iu,
  // «work remotely from anywhere in the world»
  // Не льгота «...in the world for up to 45 days per year».
  /(?<!\p{L})work(?:ing)?\s+(?:remotely\s+)?from\s+anywhere\s+in\s+the\s+world(?![^.\n]{0,30}\bdays?\b)/iu,
];

export function saysWorkFromAnywhere(title: string, description: string): boolean {
  if (TITLE_MARK.test(title)) return true;
  if (OPENING_MARK.test(description.slice(0, OPENING_LENGTH))) return true;
  return DESCRIPTION_MARKS.some((mark) => mark.test(description));
}
