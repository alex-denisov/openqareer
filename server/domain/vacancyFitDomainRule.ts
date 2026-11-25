/**
 * B794: 20 of 88 checked vacancies counted too much — «опыт в банке» met by a support role elsewhere,
 * «Terraform» by a general DevOps line, and «experience gained solely with developers will not be
 * considered» met as if it asked for that experience. Checked on every read against the facts, so a
 * stored answer needs no model call. A verdict is only lowered.
 */
import type { VacancyFitRequirementAssessment } from '../../shared/vacancyFit';

const stem = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})`, 'iu');

/** Industries a line may ask for; the same words show them in the profile. */
const INDUSTRIES: readonly RegExp[] = [
  stem('advertis|рекламн|marketing agenc'),
  stem('consult(?:ing|anc)|консалтинг'),
  stem('pharma|фарм|аптеч'),
  stem(
    'bank(?!rupt)|банк(?!рот)|fintech|финтех|financial services|финансов\\S* (?:организац|сектор|услуг)',
  ),
  stem('retail|ритейл|ретейл|розничн|e-?commerce|маркетплейс|marketplace'),
  stem('health\\s?care|behavioral health|clinical|hospital|медицин|клиник|стоматолог'),
  stem('real estate|property management|недвижимост|жкх|ук\\b|многоквартирн'),
  stem('construction|строительств|строительн|девелопмент'),
  stem('nuclear|атомн|аэс|ядерн'),
  stem('government|public sector|госсектор|государственн\\S* (?:сектор|заказ|орган)'),
  stem('insurance|страхов\\S* (?:компан|рын|сектор)'),
  stem('aviation|airport|авиац|аэропорт'),
  stem('oil (?:and|&) gas|нефтегаз|нефтян'),
  stem('gaming|game ?dev|геймдев|игров\\S* индустри'),
  stem('blockchain|блокчейн|crypto(?!graph)|крипто(?!граф)|web3'),
  stem('hotel|hospitality|гостинич|отел[ье]|ресторан'),
  stem('non-?profit|нко\\b|благотворит'),
];
/** Named tools: a general skill never shows them, so even `partial` needs the name in the profile. */
const TOOLS: readonly RegExp[] = [
  stem('terraform|opentofu'),
  stem('gitlab'),
  stem('kubernetes|k8s'),
  stem('mlops'),
  stem('dora metrics'),
  stem('1[сc](?![\\p{L}\\p{N}])'),
  stem('sap(?![\\p{L}\\p{N}])'),
  stem('битрикс|bitrix'),
];
/** A wish, an alternative or an example leaves the line open to another field. */
const OPEN_ENDED =
  /(?<!\p{L})(?:or|или|либо|similar|related|e\.g\.|such as|etc|preferred|ideally|plus|например|аналогичн\p{L}*|смежн\p{L}*|похож\p{L}*|приветству\p{L}*|преимуществ\p{L}*|желательн\p{L}*|лучше|плюсом)(?!\p{L})|\/|и (?:др\.|т\. ?[дп]\.)/iu;
/** The line asks for experience or command of the subject, not for a duty done in it. */
const ASKS =
  /опыт|стаж|знани|владени|навык|понимани|experience|track record|knowledge|proficien|expertise|background/iu;
const inBrackets = (text: string): string => text.replace(/\([^)]*\)/gu, ' ');
const EXCLUSION =
  /will not (?:be (?:considered|accepted)|meet|qualify|suffice)|(?:is|are) not (?:considered|accepted|sufficient|suitable)|we (?:do not|don['’]t) (?:consider|accept)|does not count|не рассматрива|не подойд|не подход(?:ит|ят)|не учитыва|не принима/iu;

const shownIn = (statements: readonly string[], subjects: readonly RegExp[]): boolean =>
  subjects.some((item) => statements.some((fact) => item.test(fact)));

/** True when the line asks for an industry and no fact of the profile mentions any it names. */
export function namesUnknownIndustry(text: string, statements: readonly string[]): boolean {
  // Brackets list posts or examples: «leadership (COO, Head of Operations) in agencies».
  const line = inBrackets(text);
  if (!ASKS.test(line) || OPEN_ENDED.test(line)) return false;
  // Several industries of which the profile shows one leave the verdict to the model.
  const asked = INDUSTRIES.filter((item) => item.test(line));
  return asked.length > 0 && !shownIn(statements, asked);
}

/** True when the line is about one tool (or its twins) the profile never names. */
export function namesUnknownTool(text: string, statements: readonly string[]): boolean {
  const line = inBrackets(text);
  // A list, a pair or an alternative has other parts the profile may show.
  if (!ASKS.test(line) || /,|(?<!\p{L})(?:или|or|либо|и|and|und)(?!\p{L})/iu.test(line))
    return false;
  const asked = TOOLS.filter((item) => item.test(line));
  return asked.length > 0 && !shownIn(statements, asked);
}

/** «Опыт только у застройщиков не рассматривается»: a filter on candidates, shown by no quote. */
export const isExclusionLine = (text: string): boolean => EXCLUSION.test(text);

export function withDomainRule(
  item: VacancyFitRequirementAssessment,
  text: string,
  statements: readonly string[],
): VacancyFitRequirementAssessment {
  if (item.status !== 'matched' && item.status !== 'partial') return item;
  const unknown = { requirementId: item.requirementId, status: 'unknown' as const, evidence: [] };
  if (isExclusionLine(text) || namesUnknownTool(text, statements)) return unknown;
  return item.status === 'matched' && namesUnknownIndustry(text, statements)
    ? { ...item, status: 'partial' }
    : item;
}
