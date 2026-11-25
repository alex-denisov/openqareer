import { isSearchIntent } from './resumeSearchIntent';

/** «О себе» резюме под вакансию: дословные предложения профиля без строк поиска и контактов (B785). */
const MAX_CHARACTERS = 700;
const MAX_SENTENCES = 5;
const EMOJI =
  /(?![©®™])\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D}|\u{20E3}/gu;
const MARK = /^[\s•·●▪◦*✓–—-]+(?=\S)/u;
const CONTACT =
  /\S@\S+\.\p{L}{2,}|(?<![\p{L}\d])@\w{3,}|\bt\.me\/|linkedin\.com|(?<!\p{L})(?:contacts?|e-?mail|telegram|whatsapp|phone|контакты?|почта|телеграм|телефон)\s*:|\+\d[\d\s()-]{8,}/iu;
const SEARCH =
  /^(?:open to|available for|open for|seeking|looking for|reach out|let['’]s (?:connect|talk)|feel free|ищу|открыт[аы]? (?:к|для)|готов[аы]? к (?:переезд|релокац)\p{L}*|рассматриваю|в поиске|свяжитесь|пишите)(?!\p{L})/iu;

const isHeading = (line: string): boolean =>
  /\p{L}/u.test(line) &&
  ((line === line.toLocaleUpperCase() && /\p{Lu}{3}/u.test(line) && !/\d/u.test(line)) ||
    /:$/u.test(line));

const isOwnLine = (line: string): boolean =>
  line !== '' &&
  !isHeading(line) &&
  !/\s\|\s/u.test(line) &&
  !/^(?:core )?(?:competenc|skills|ключевые навыки)[^.]*:/iu.test(line);

const sentencesOf = (line: string): string[] =>
  line.split(/(?<=[.!?…])\s+(?=[\p{Lu}\d«"$])/u).filter(Boolean);

const isOwnSentence = (text: string): boolean =>
  !CONTACT.test(text) && !SEARCH.test(text) && !isSearchIntent(text);

export function vacancyAbout(about: string): string {
  const sentences = about
    .split('\n')
    .map((line) => line.replace(EMOJI, '').replace(MARK, '').replace(/\s+/gu, ' ').trim())
    .filter(isOwnLine)
    .flatMap(sentencesOf)
    .filter(isOwnSentence)
    .map((text) => (/[.!?…]$/u.test(text) ? text : `${text}.`));
  const first = sentences.slice(0, MAX_SENTENCES);
  const kept: string[] = [];
  for (const text of first) {
    if (kept.length > 0 && [...kept, text].join(' ').length > MAX_CHARACTERS) break;
    kept.push(text);
  }
  return kept.join(' ');
}
