import { LAST, nameFact, whole } from '../../../../../shared/candidateName';
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
