/**
 * CIO и «ИТ-директор» равны по смыслу (владелец 04.11): одна функция `it-ops` и уровень C-level.
 * Заместитель и помощник — не первое лицо. Русское название допускает хвост («ИТ-директор группы
 * компаний»); английское и «директор ИТ» — только целиком: «Director of IT Audit», «Директор IT-колледжа»
 * и «Операционный директор ИТ» — другие роли.
 */
const DEPUTY =
  /(?<!\p{L})(?:deputy|assistant|associate|заместител\p{L}*|помощник\p{L}*)(?!\p{L})/iu;

const FOREIGN_FIRST_WORD = /(?<!\p{L})(?:операционн|финансов|генеральн|коммерческ|исполнительн)\p{L}*\s+$/iu;

const RUSSIAN_NAME =
  /(?<![\p{L}-])(?:(?:ит|it)[- ]директор|директор по (?:ит|it|информационным технологиям))(?![\p{L}-])/iu;

const ALONE_TAIL = '\\s*(?:$|[/(|–—]|\\s-\\s|\\sii?$)';

const WHOLE_NAME = new RegExp(
  `^(?:(?:senior|sr\\.?|global|group|regional|corporate|executive|divisional?|apac|emea)\\s+)*` +
    `(?:it director|it-director|director of it|director of information technology|information technology director|директор (?:ит|it))${ALONE_TAIL}`,
  'iu',
);

/** Такое же название внутри составного: «CTO / ИТ-директор», «Директор ИТ / Руководитель проектов». */
function alternatives(title: string): string[] {
  return title.split(/\s*[/|,]\s*|\s[–—-]\s/u).map((part) => part.trim());
}

function russianNameMatches(part: string): boolean {
  const match = RUSSIAN_NAME.exec(part);
  return match !== null && !FOREIGN_FIRST_WORD.test(part.slice(0, match.index));
}

export function isChiefInformationTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed || DEPUTY.test(trimmed)) return false;
  return alternatives(trimmed).some((part) => russianNameMatches(part) || WHOLE_NAME.test(part));
}
