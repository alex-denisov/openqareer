/**
 * B794: what the employer gives or where and when the job is done («Комфортный офис», «График 5/2»,
 * «Work Location: Remote») is no requirement of the candidate: it is not listed among them. Degree,
 * language, licence, permit and readiness to travel or move stay. Read on display, so no percent expires.
 */
interface RequirementLine {
  readonly text: string;
  readonly kind?: string;
  readonly skill?: boolean;
}

const WORK_TERM =
  /^(?:место работы|локация|location|work location|график|рабочее время|рабочий день|режим работы|гибкое начало|(?:полная|частичная) занятость|занятость|полный рабочий день|(?:permanent|full[- ]?time|part[- ]?time|w-?2|contract)(?!\p{L})|employment type|position level|job type)|(?:официальн\S*|полное) (?:оформлени|трудоустройств|соблюдени)|^(?:оформлени|трудоустройств)|(?:по|соблюдени\S*|соответствии с) ТК(?!\p{L})|ДМС(?!\p{L})|(?<!\p{L})(?:комфортн|современн|уютн)\S* (?:[\p{L}-]+ )?(?:офис|рабоч\S* пространств|пространств)|бесплатн\S* (?:питани|парковк|обед)|стабильн\S* (?:компани|зарплат|заработн)|бел\S* (?:зарплат|заработн)|возможност\S* (?:для )?(?:карьерн|профессиональн|рост)|(?:проживани|жиль[её])\S* (?:.{0,40} )?за сч[её]т|компенсаци\S* (?:проживани|питани|проезд|парковк)|корпоративн\S* (?:транспорт|скидк|обучени)|полис ДМС|в подчинении |прям\S* подчинени|^работа (?:в|на|с) (?!команд)/iu;
const CANDIDATE_ASK =
  /готовност|опыт|навык|умени|знани|аттестат|сертификат|experience|ability|willing|must/iu;

export function isWorkTerm(requirement: RequirementLine): boolean {
  const { kind, skill, text } = requirement;
  if (kind === 'workFormat') return !skill;
  if (kind !== 'other' || skill !== false) return false;
  return WORK_TERM.test(text.trim()) && !CANDIDATE_ASK.test(text);
}
