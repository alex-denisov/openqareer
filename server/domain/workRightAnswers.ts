import type { WorkRight } from '../../shared/workPreferences';
import type {
  QuestionnaireQuestion,
  QuestionnaireSuggestion,
} from '../../shared/applicationQuestionnaire';
import { countryCodeFromNameOrCode } from './geoCoordinates';

/**
 * B788: право на работу и виза — только из того, что кандидат сам подтвердил про эту страну.
 * По гражданству и месту жительства ничего не выводится.
 */
const SOURCE = 'Из ваших ответов о праве на работу';

const RIGHT =
  /(authori[sz]ed|authori[sz]ation|eligible|entitled|permitted|legally able|right) to (live|work|reside)|work authori[sz]ation|(valid|have a) work permit|прав\S* на работу|разрешени\S* на работу|прав\S* (на )?(проживани|жить|работать)/iu;
const SPONSOR =
  /(require|need)\S* [^.?]*(sponsorship|visa|work permit)|(нужн|требует|понадоб)\S* [^.?]*(виз|спонсорств|разрешени)/iu;
const WITHOUT_SPONSOR = /without [^.?]*(sponsor|visa)|без [^.?]*(виз|спонсорств)/iu;
const FUTURE = /future|ever|в будущем/iu;

const EU = 'EU';
const EU_MEMBERS: ReadonlySet<string> = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '),
);

/** Русские названия в косвенных падежах и сокращения, которых нет в справочнике стран. */
const NAMED: readonly (readonly [RegExp, string])[] = [
  [/(?<!\p{L})США(?!\p{L})|\bU\.?S\.?A?\.?(?=\W|$)|united states/u, 'US'],
  [/(?<!\p{L})(ЕС|Европ\p{L}*)(?!\p{L})|\bEU\b|european union|\bEurope\b/iu, EU],
  [/\bU\.?K\.?(?=\W|$)|great britain|united kingdom|британи/iu, 'GB'],
  [/герман/iu, 'DE'],
  [/польш/iu, 'PL'],
  [/росси|(?<!\p{L})РФ(?!\p{L})/iu, 'RU'],
  [/испани/iu, 'ES'],
  [/португал/iu, 'PT'],
  [/нидерланд/iu, 'NL'],
  [/кипр/iu, 'CY'],
  [/серби/iu, 'RS'],
  [/(?<!\p{L})ОАЭ(?!\p{L})|\bUAE\b/u, 'AE'],
  [/казахстан/iu, 'KZ'],
];
const MAX_NAME_WORDS = 3;

/** Страны, названные в вопросе; больше одной — страна не определена. */
function namedCountries(text: string): ReadonlySet<string> {
  const fixed = NAMED.flatMap(([pattern, code]) => (pattern.test(text) ? [code] : []));
  const words = text.match(/\p{L}[\p{L}'’-]*/gu) ?? [];
  const listed = words.flatMap((word, from) =>
    /^\p{Lu}/u.test(word)
      ? Array.from({ length: MAX_NAME_WORDS }, (_, more) =>
          words.slice(from, from + more + 1).join(' '),
        )
          .filter((name) => name.length > 3)
          .flatMap((name) => countryCodeFromNameOrCode(name) ?? [])
      : [],
  );
  return new Set([...fixed, ...listed]);
}

/** Вопрос называет место, которого нет в справочнике: страна вакансии за него не отвечает. */
const OTHER_PLACE = /\b(in|for) (the )?(?!country\b)\p{Lu}\p{Ll}+|(?<!\p{L})в \p{Lu}\p{Ll}+/u;

type Asked = {
  readonly kind: 'right' | 'sponsor';
  readonly country: string;
  readonly future: boolean;
};

function askedRight(text: string, vacancyCountry: string | undefined): Asked | null {
  const right = RIGHT.test(text);
  const sponsor = SPONSOR.test(text);
  const without = WITHOUT_SPONSOR.test(text);
  if (!right && !sponsor) return null;
  // «Вправе работать и нужна ли виза» одним вопросом: «да» значило бы разное.
  if (right && sponsor && !without) return null;
  const named = namedCountries(text);
  if (named.size > 1 || (named.size === 0 && OTHER_PLACE.test(text))) return null;
  const country = [...named][0] ?? vacancyCountry;
  if (!country) return null;
  return { kind: right ? 'right' : 'sponsor', country, future: FUTURE.test(text) };
}

function statusFor(rights: readonly WorkRight[], country: string): WorkRight['status'] | undefined {
  const exact = rights.find((item) => item.country === country);
  if (exact) return exact.status;
  if (!EU_MEMBERS.has(country)) return undefined;
  return rights.find((item) => item.country === EU)?.status;
}

const YES = /^(yes|да)$/iu;
const NO = /^(no|нет)$/iu;

function yesNo(question: QuestionnaireQuestion, yes: boolean): string | undefined {
  if (question.kind === 'choice') {
    const pattern = yes ? YES : NO;
    return question.options?.find((option) => pattern.test(option.trim()));
  }
  const russian = /\p{Script=Cyrillic}/u.test(question.text);
  if (russian) return yes ? 'Да' : 'Нет';
  return yes ? 'Yes' : 'No';
}

export function workRightAnswers(
  questions: readonly QuestionnaireQuestion[],
  rights: readonly WorkRight[],
  vacancyCountry: string | undefined,
): readonly QuestionnaireSuggestion[] {
  if (rights.length === 0) return [];
  return questions.flatMap((question) => {
    const asked = askedRight(question.text, vacancyCountry);
    const status = asked ? statusFor(rights, asked.country) : undefined;
    if (!asked || !status) return [];
    // Право сегодня не говорит, понадобится ли виза потом.
    if (asked.kind === 'sponsor' && asked.future && status === 'authorized') return [];
    const text = yesNo(question, (status === 'authorized') === (asked.kind === 'right'));
    return text ? [{ questionId: question.id, text, source: SOURCE }] : [];
  });
}

/** Что кандидат сам ответил про страну: «да»/«нет» о праве, «да» о визе. */
export function learnedWorkRights(
  questions: readonly QuestionnaireQuestion[],
  changed: ReadonlyMap<string, string>,
  vacancyCountry: string | undefined,
): readonly WorkRight[] {
  return questions.flatMap((question): readonly WorkRight[] => {
    const text = changed.get(question.id)?.trim() ?? '';
    const asked = askedRight(question.text, vacancyCountry);
    if (!asked) return [];
    const { country, kind } = asked;
    const needsVisa = kind === 'right' ? NO.test(text) : YES.test(text);
    if (needsVisa) {
      // «Не вправе без визы» и «нужна виза» — одно и то же для кандидата.
      return [{ country, status: 'needs_visa' }];
    }
    return kind === 'right' && YES.test(text) ? [{ country, status: 'authorized' }] : [];
  });
}

export function mergeWorkRights(
  known: readonly WorkRight[],
  learned: readonly WorkRight[],
): readonly WorkRight[] {
  const byCountry = new Map([...known, ...learned].map((item) => [item.country, item]));
  return [...byCountry.values()];
}
