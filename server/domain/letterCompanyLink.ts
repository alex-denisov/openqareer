import { isMaskWord } from '../../shared/employerMask';

/**
 * B639: кандидат работал в компании вакансии или её группе (Корпоративный университет Сбера —
 * вакансия Сбера). Это сильнейший довод письма: run-15 ставил его во вводный абзац, а после
 * правки длины модель его теряла. Совпадение ищется по словам-брендам: общие слова и правовые
 * формы отбрасываются, кириллица сравнивается с латиницей, «Сбер» и «Сбера» — одно слово.
 */
const LEGAL_AND_GROUP_WORDS: ReadonlySet<string> = new Set([
  'пао', 'ооо', 'ао', 'зао', 'оао', 'ип', 'нко', 'гк', 'llc', 'inc', 'ltd', 'gmbh', 'plc', 'corp',
  'co', 'sa', 'ag', 'bv', 'lab', 'labs', 'лаборатория', 'тех', 'tech', 'digital', 'цифра', 'cloud',
  'университет', 'university', 'развития', 'development',
]);

const TRANSLIT: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const MIN_STEM = 4;
const STEM_SHARE = 0.8;

function brandWords(name?: string): string[] {
  return (name ?? '')
    .toLocaleLowerCase('ru-RU')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !isMaskWord(word) && !LEGAL_AND_GROUP_WORDS.has(word))
    .map((word) => [...word].map((letter) => TRANSLIT[letter] ?? letter).join(''));
}

function commonPrefix(left: string, right: string): number {
  let length = 0;
  while (length < left.length && left[length] === right[length]) length += 1;
  return length;
}

function sameBrand(left: string, right: string): boolean {
  if (left === right) return left.length >= 2;
  const shorter = Math.min(left.length, right.length);
  const prefix = commonPrefix(left, right);
  return shorter >= MIN_STEM && prefix >= MIN_STEM && prefix >= shorter * STEM_SHARE;
}

export function sameCompanyGroup(vacancyCompany?: string, employer?: string): boolean {
  const employerWords = brandWords(employer);
  return brandWords(vacancyCompany).some((word) =>
    employerWords.some((other) => sameBrand(word, other)),
  );
}

/** Место кандидата (настоящее название), связанное с компанией вакансии, если оно есть. */
export function letterCompanyLink(
  vacancyCompany: string | undefined,
  employers: readonly string[],
): string | undefined {
  return employers.find((employer) => sameCompanyGroup(vacancyCompany, employer));
}
