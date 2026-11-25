import { isSearchIntent } from './resumeSearchIntent';

/** «О себе» резюме под вакансию: дословные предложения профиля без строк поиска и контактов (B785). */
const MAX_CHARACTERS = 700;
const MAX_SENTENCES = 5;
const EMOJI =
  /(?![©®™])\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D}|\u{20E3}/gu;
/** Метка пункта; «-5%» и перенос «— не только» — не метка. */
const MARK = /^\s*(?:[•·●▪◦*✓]\s*|[–—-]\s+(?=[\p{Lu}\d$€£₽]))/u;
const DASH = /^\s*[–—-]\s+/u;
const PHONE = /(?<!\d)\+?\d(?:[\s()-]*\d){9,}/gu;
/** «89 000 000 000» — сумма, а не телефон. */
const AMOUNT = /^\d{1,3}(?:\s\d{3}){2,}$/u;
const hasPhone = (text: string): boolean =>
  [...text.matchAll(PHONE)].some(([match]) => !AMOUNT.test(match));
const CONTACT =
  /\S@\S+\.\p{L}{2,}|(?<![\p{L}\d])@\w{3,}|\bt\.me\/|linkedin\.com|(?<!\p{L})(?:contacts?|e-?mail|telegram|whatsapp|phone|контакты?|почта|телеграм|телефон)\s*(?::|@|\+?\d|$)/iu;
const SEARCH =
  /^(?:(?:i am|i['’]m|i|currently|now|actively|also|я|сейчас|активно|также)\s+)*(?:open (?:to|for)|available (?:for|from|immediately|now)|(?:seeking|looking for|searching for)(?!.*,\s*(?:i|we)(?!\p{L}))|ready to relocate|willing to|interested in\b.{0,80}\b(?:roles?|positions?|opportunit|jobs?|offers?|work)|reach out|contact me|let['’]s (?:connect|talk)|feel free|ищу|в поиске|открыт[аы]? (?:к|для)|готов[аы]? (?:к (?:переезд|релокац|предложени)|рассмотреть|переехать)|рассм[ао]тр\p{L}*|интересу(?:ют|ет|юсь).{0,60}(?:ваканси|позици|предложени|должност|рол[ьи])|свяжитесь|пишите|звоните)/iu;
const RELOCATE = /\b(?:willing|ready|open|able) to relocate\b|готов[аы]? к (?:переезд|релокац)/iu;
/** Слово, которым фраза не кончается: следующая строка её продолжает. */
const OPEN_END =
  /(?:[,&/–—-]|(?<!\p{L})(?:and|or|of|the|a|an|to|for|with|in|on|at|by|from|that|и|или|в|во|на|с|со|по|для|от|до|из|к|о|об|за|над|при|что))$/iu;

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
  !CONTACT.test(text) &&
  !hasPhone(text) &&
  !SEARCH.test(text) &&
  !RELOCATE.test(text) &&
  !isSearchIntent(text);

/** Строки профиля; перенос внутри фразы склеен обратно. */
function linesOf(about: string): string[] {
  const lines: string[] = [];
  const rows = about.split('\n').map((raw) => ({ raw, plain: raw.replace(EMOJI, '') }));
  const filled = rows.filter(({ plain }) => plain.trim() !== '');
  // Одиночное тире продолжает фразу, тире подряд — список.
  const listed = new Set(
    filled.filter(
      ({ plain }, index) =>
        DASH.test(plain) &&
        [filled[index - 1], filled[index + 1]].some((next) => next && DASH.test(next.plain)),
    ),
  );
  for (const row of rows) {
    const { raw } = row;
    const plain = listed.has(row) ? row.plain.replace(DASH, '• ') : row.plain;
    const marked = plain !== raw || MARK.test(plain);
    const line = plain.replace(MARK, '').replace(/\s+/gu, ' ').trim();
    const last = lines.at(-1) ?? '';
    const broken =
      !marked &&
      last !== '' &&
      line !== '' &&
      !/[.!?…:]$/u.test(last) &&
      !isHeading(line) &&
      (/^[\p{Ll}–—(]/u.test(line) || OPEN_END.test(last));
    if (broken) lines.splice(-1, 1, `${last} ${line}`);
    else lines.push(line);
  }
  return lines;
}

/** Слишком длинная фраза кончается на границе своей части. */
function cut(text: string): string {
  if (text.length <= MAX_CHARACTERS) return text;
  const head = text.slice(0, MAX_CHARACTERS - 1);
  const end = Math.max(...[';', ' — ', ' – ', ','].map((mark) => head.lastIndexOf(mark)));
  const part = end > 0 ? head.slice(0, end) : head.slice(0, head.lastIndexOf(' '));
  return part ? `${part.trimEnd()}.` : '';
}

export function vacancyAbout(about: string): string {
  const sentences = linesOf(about)
    .filter(isOwnLine)
    .flatMap(sentencesOf)
    .filter(isOwnSentence)
    .map((text) => cut(/[.!?…]$/u.test(text) ? text : `${text}.`))
    .filter(Boolean);
  return sentences.slice(0, MAX_SENTENCES).reduce((kept, text, index, all) => {
    const before = all.slice(0, index).join(' ');
    if (kept !== before) return kept;
    const next = kept ? `${kept} ${text}` : text;
    return next.length <= MAX_CHARACTERS ? next : kept;
  }, '');
}
