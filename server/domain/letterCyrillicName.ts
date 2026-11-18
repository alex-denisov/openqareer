/**
 * B714: русское письмо подписано кириллицей. Модель обычно возвращает имя на языке письма (B624);
 * когда не вернула, а в профиле имя латиницей, имя транслитерируется по-русски («Alexey Denisov» →
 * «Алексей Денисов»). Это запасной путь: точность словаря не нужна, нужна письменность письма.
 */
const MULTI: readonly (readonly [string, string])[] = [
  ['shch', 'щ'],
  ['sch', 'щ'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['ch', 'ч'],
  ['sh', 'ш'],
  ['yu', 'ю'],
  ['ya', 'я'],
  ['yo', 'ё'],
  ['iy', 'ий'],
  ['ck', 'к'],
  ['ph', 'ф'],
  ['x', 'кс'],
];

const SINGLE: Readonly<Record<string, string>> = {
  a: 'а',
  b: 'б',
  c: 'к',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'х',
  i: 'и',
  j: 'дж',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'к',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  z: 'з',
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/** «y»: после гласной — «й», в конце после согласной — «ий» (Dmitry), иначе «ы». */
function letterY(previous: string | undefined, atEnd: boolean): string {
  if (previous && VOWELS.has(previous)) return 'й';
  return atEnd && previous ? 'ий' : 'ы';
}

function cyrillicWord(word: string): string {
  const lower = word.toLowerCase();
  let out = '';
  let index = 0;
  while (index < lower.length) {
    const multi = MULTI.find(([latin]) => lower.startsWith(latin, index));
    if (multi) {
      out += multi[1];
      index += multi[0].length;
      continue;
    }
    const char = lower[index]!;
    out +=
      char === 'y' ? letterY(lower[index - 1], index === lower.length - 1) : (SINGLE[char] ?? char);
    index += 1;
  }
  // Юлия, Мария: «ia» в конце имени по-русски «ия».
  const named = out.endsWith('иа') ? out.slice(0, -1) + 'я' : out;
  return named ? named[0]!.toUpperCase() + named.slice(1) : named;
}

/** Имя латиницей → кириллицей по словам; в имени уже есть кириллица — без изменений. */
export function russianProperName(name: string): string {
  if (/\p{Script=Cyrillic}/u.test(name)) return name;
  return name.replace(/\p{Script=Latin}+/gu, cyrillicWord);
}
