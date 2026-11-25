import type { AtsField } from './atsFormTypes';

/** B787: поля о самом кандидате. Узнаются по разметке формы, затем по фиксированным подписям. */
export interface IdentityFacts {
  readonly fullName?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly linkedin?: string;
  readonly location?: string;
  readonly city?: string;
  readonly country?: string;
  readonly website?: string;
}
type Fact = keyof IdentityFacts;

/** Подпись целиком, с необязательным уточнением в скобках: «Имя рекомендателя» — не «Имя». */
const whole = (words: string) =>
  new RegExp(`^(?:your |my |ваш[ае]? |legal |preferred )?(?:${words})(?: ?\\(.*\\))?$`, 'iu');

const FIRST = whole(
  "first(?: |-)?name(?: ?[/&-].*)?|given name|forename|имя|vorname|prénom|prenom|nombres?|primeiro nome|nome próprio|voornaam|imi[ęe]|förnamn|fornavn|etunimi|jméno|krstné meno|keresztnév|prenume|ім[’'ʼ]я",
);
const LAST = whole(
  'last(?: |-)?name|surname|family name|фамилия|nachname|familienname|nom de famille|apellidos?|cognome|sobrenome|apelido|último nome|achternaam|nazwisko|efternamn|etternavn|efternavn|sukunimi|příjmení|priezvisko|vezetéknév|nume de familie|прізвище',
);
const FULL = whole(
  'full ?name|first and last name|name and surname|полное имя|имя и фамилия|фамилия и имя|фамилия,? имя(?:,? отчество)?|фио|ф\\.\\s?и\\.\\s?о\\.?|vollständiger name|vor- und nachname|vor- & nachname|nom complet|nom et prénom|prénom et nom|nombre completo|nombre y apellidos?|nome completo|nome e cognome|nome e sobrenome|volledige naam|imi[ęe] i nazwisko|fullständigt namn|fullt navn|koko nimi',
);
/** Одно слово: что оно значит, решает соседнее поле. */
const BARE_NAME = whole('name|имя|nombre|nome|naam|namn|navn|nimi|jméno|nume');
const BARE_SURNAME = whole('nom');

const LABELS: readonly (readonly [RegExp, Fact])[] = [
  [LAST, 'lastName'],
  [
    whole(
      'e-?mail(?:[ -]?(?:address|adresse|adres|adress))?|correo(?: electrónico)?|adresse e-?mail|courriel|indirizzo e-?mail|posta elettronica|endereço de e-?mail|электронная почта|эл\\. почта|почта|адрес(?: электронной)? почты|email-?адрес|e-post(?:adress)?|sähköposti|adres e-?mail|електронна пошта',
    ),
    'email',
  ],
  [
    whole(
      '(?:mobile |cell |tele|contact )?phone(?: number)?|mobile(?: number)?|(?:контактный |мобильный )?телефон|номер телефона|telefon(?:nummer|o|e)?|teléfono(?: móvil)?|téléphone(?: portable)?|numéro de téléphone|número de teléfono|numero di telefono|cellulare|móvil|celular|handynummer|mobilnummer|mobiltelefon|telefoonnummer|numer telefonu|puhelin(?:numero)?',
    ),
    'phone',
  ],
  [
    whole('country(?: of residence)?|страна(?: проживания)?|land|pays|país|paese|kraj|maa'),
    'country',
  ],
  [
    whole(
      'city|current city|город(?: проживания)?|stadt|wohnort|ville|ciudad|città|cidade|stad|woonplaats|miasto|ort',
    ),
    'city',
  ],
  [
    whole(
      '(?:current )?location(?: ?,? city)?|место ?жительства|локация|местоположение|ubicación|localização',
    ),
    'location',
  ],
  [
    whole('(?:personal )?web ?site(?: url)?|portfolio(?: (?:url|link|website))?|сайт|портфолио'),
    'website',
  ],
];

const LINKEDIN =
  /^(?:your |link to your |ссылка на )?(?:профиль (?:в )?)?linked-?in(?:[ -]?(?:profile|url|link|page|account|profil|профиль|ссылка|perfil|-профиль))*(?: ?\(.*\))?$|^(?:profil|perfil|profilo|lien|enlace|link|url) (?:de |do |di |para |zu |au )?linked-?in$/iu;

/** Разметка формы: не зависит от языка подписи. */
const AUTOCOMPLETE: Readonly<Record<string, Fact>> = {
  'given-name': 'firstName',
  'family-name': 'lastName',
  name: 'fullName',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'address-level2': 'city',
  'country-name': 'country',
};

/** Поле о другом человеке или о чужом контакте. */
const NOT_CANDIDATE =
  /refer|manager|supervisor|emergency|recruiter|employer|company|how did|where did|рекоменд|руковод|экстрен|компани|работодат|узнали/iu;

function nameFact(label: string, labels: readonly string[]): Fact | null {
  const has = (pattern: RegExp) => labels.some((other) => other !== label && pattern.test(other));
  if (FULL.test(label)) return 'fullName';
  if (BARE_SURNAME.test(label)) return has(FIRST) ? 'lastName' : 'fullName';
  if (BARE_NAME.test(label)) return has(LAST) ? 'firstName' : 'fullName';
  return FIRST.test(label) ? 'firstName' : null;
}

/** О чём поле: `null` — это не данные кандидата. */
export function identityFact(field: AtsField, fields: readonly AtsField[]): Fact | null {
  const tidy = (label: string) => label.trim().replace(/\s*[:*✱]+$/u, '');
  const label = tidy(field.label);
  if (NOT_CANDIDATE.test(label)) return null;
  const hint = field.autocomplete?.trim().toLowerCase().split(/\s+/u).at(-1) ?? '';
  if (Object.hasOwn(AUTOCOMPLETE, hint)) return AUTOCOMPLETE[hint]!;
  if (field.kind === 'email') return 'email';
  if (field.kind === 'tel') return 'phone';
  if (LINKEDIN.test(label)) return 'linkedin';
  const known = LABELS.find(([pattern]) => pattern.test(label));
  return known
    ? known[1]
    : nameFact(
        label,
        fields.map((other) => tidy(other.label)),
      );
}

/** Значение из профиля; у списка — только его собственный вариант. */
export function identityOf(
  field: AtsField,
  fields: readonly AtsField[],
  facts: IdentityFacts,
): string | undefined {
  const fact = identityFact(field, fields);
  const value = fact ? facts[fact]?.trim() : undefined;
  if (!value || field.options.length === 0) return value || undefined;
  return field.options.find((option) => option.label.trim().toLowerCase() === value.toLowerCase())
    ?.label;
}

const PATRONYMIC = /(?:ович|евич|ич|овна|евна|ична|инична)$/iu;

/** Имя и фамилия из полного имени — только когда порядок слов понятен; иначе их впишет кандидат. */
export function splitName(fullName: string): Pick<IdentityFacts, 'firstName' | 'lastName'> {
  const words = fullName.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 2) return { firstName: words[0], lastName: words[1] };
  if (words.length !== 3) return {};
  if (PATRONYMIC.test(words[2]!)) return { firstName: words[1], lastName: words[0] };
  return PATRONYMIC.test(words[1]!) ? { firstName: words[0], lastName: words[2] } : {};
}
