/** B787: имя кандидата в форме работодателя — одно правило для веба и приложения. */
export type NameFact = 'fullName' | 'firstName' | 'lastName';

export interface SplitName {
  readonly firstName?: string;
  readonly lastName?: string;
}

/** Подпись целиком, с необязательным уточнением в скобках: «Имя рекомендателя» — не «Имя». */
export const whole = (words: string) =>
  new RegExp(`^(?:your |my |ваш[ае]? |legal |preferred )?(?:${words})(?: ?\\(.*\\))?$`, 'iu');

const FIRST = whole(
  "first(?: |-)?name(?: ?[/&-].*)?|given name|forename|имя|vorname|prénom|prenom|nombres?|primeiro nome|nome próprio|voornaam|imi[ęe]|förnamn|fornavn|etunimi|jméno|krstné meno|keresztnév|prenume|ім[’'ʼ]я",
);
export const LAST = whole(
  'last(?: |-)?name|surname|family name|фамилия|nachname|familienname|nom de famille|apellidos?|cognome|sobrenome|apelido|último nome|achternaam|nazwisko|efternamn|etternavn|efternavn|sukunimi|příjmení|priezvisko|vezetéknév|nume de familie|прізвище',
);
const FULL = whole(
  'full ?name|first and last name|name and surname|полное имя|имя и фамилия|фамилия и имя|фамилия,? имя(?:,? отчество)?|фио|ф\\.\\s?и\\.\\s?о\\.?|vollständiger name|vor- und nachname|vor- & nachname|nom complet|nom et prénom|prénom et nom|nombre completo|nombre y apellidos?|nome completo|nome e cognome|nome e sobrenome|volledige naam|imi[ęe] i nazwisko|fullständigt namn|fullt navn|koko nimi',
);
/** Одно слово: что оно значит, решает соседнее поле. */
const BARE_NAME = whole('name|имя|nombre|nome|naam|namn|navn|nimi|jméno|nume');
const BARE_SURNAME = whole('nom');

/** Какое имя спрашивает подпись; `labels` — подписи всей формы. */
export function nameFact(label: string, labels: readonly string[]): NameFact | null {
  const has = (pattern: RegExp) => labels.some((other) => other !== label && pattern.test(other));
  if (FULL.test(label)) return 'fullName';
  if (BARE_SURNAME.test(label)) return has(FIRST) ? 'lastName' : 'fullName';
  if (BARE_NAME.test(label)) return has(LAST) ? 'firstName' : 'fullName';
  if (LAST.test(label)) return 'lastName';
  return FIRST.test(label) ? 'firstName' : null;
}

const PATRONYMIC = /(?:ович|евич|ич|овна|евна|ична|инична)$/iu;

/** Имя и фамилия из полного имени — только когда порядок слов понятен; иначе их впишет кандидат. */
export function splitName(fullName: string): SplitName {
  const words = fullName.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 2) return { firstName: words[0], lastName: words[1] };
  if (words.length !== 3) return {};
  if (PATRONYMIC.test(words[2]!)) return { firstName: words[1], lastName: words[0] };
  return PATRONYMIC.test(words[1]!) ? { firstName: words[0], lastName: words[2] } : {};
}
