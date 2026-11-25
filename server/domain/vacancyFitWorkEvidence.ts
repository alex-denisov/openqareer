/**
 * B794 (25.11): a VP with 250 people and P&L read «частично» on «опыт руководства ИТ от 5 лет» and
 * «формирование ИТ-бюджета»: the model neither sums places nor lets several bullets back one line.
 * Both are counted here from the places of work, on every read, so an old answer needs no new call.
 * A word outside the named areas (an industry, a product, a number) leaves the model's verdict as is.
 */
import { mergedMonths, monthIndex } from './resumeMonth';

export interface WorkFact {
  readonly id: string;
  readonly statement: string;
}

const L = '\\p{L}';
const area = (name: string, asked: string, shown: string) => ({
  name,
  asked: new RegExp(`^(?:${asked})`, 'iu'),
  shown: new RegExp(`(?<!${L})(?:${shown})`, 'iu'),
});

/** What a requirement may ask, as word stems, and what a line of work must say to show it. */
const AREAS = [
  area('budget', 'бюджет|budget|затрат|расход|p&l', 'budget|бюджет|p&l'),
  area(
    'team',
    'команд|сотрудник|персонал|подчин|team|людьми|специалист|отдел|департамент|подбор|найм|обучен|адаптац|department',
    'team of|direct reports|команда \\d|сотрудник|hiring|trained',
  ),
  area(
    'contracts',
    'подрядчик|вендор|поставщик|договор|контракт|тендер|закупк|vendor|contract|supplier',
    'contract|contractors|tender|procurement|подрядчик|контракт',
  ),
  area('sla', 'sla', 'sla'),
  area(
    'service',
    'поддержк|support|сервис|service|itil|itsm|инцидент|incident|обращени',
    'support|itil|itsm|incident|поддержк',
  ),
  area('infrastructure', 'инфраструктур|infrastructure', 'infrastructure|инфраструктур'),
  area('process', 'процесс|process|регламент|стандарт', 'process|процесс'),
  area(
    'strategy',
    'стратег|strateg|трансформац|transformation',
    'strategic|strategy|turnaround|стратег|transformation',
  ),
  area('network', 'сет[ьией]|сетев|network', 'network|сет[ьией]'),
  area('servers', 'сервер|server|виртуализац|virtuali', 'server|virtuali|сервер'),
  area('cloud', 'облак|облач|cloud', 'cloud|облач'),
  area('erp', 'erp', 'erp'),
  area('automation', 'автоматизац|automation', 'automat|автоматиз'),
  area('development', 'разработк', 'product development|developed|designed, built|разработк'),
  area('devops', 'devops', 'devops'),
  area('monitoring', 'мониторинг|monitoring', 'monitoring|мониторинг'),
] as const;

/** Words that add no subject of their own. «Опыт», «управления», «формирование и защита». */
const PLAIN = new RegExp(
  `^(?:опыт|experience|умени|навык|skill|знани|понимани|управл|руковод|manag|lead|head|организ|построени|создани|развит|develop|build|формирован|защит|контрол|планирован|оптимизац|работ|work|обоснован|ведени|it-\\S*|ит-\\S*|технич|technical|информационн|технолог|внутренн|внешн|internal|external|годов|эффективн|strong|уверенн|успешн|практическ|подтвержд|proven|бизнес|корпоратив|компани|сервисн|отделом|взаимодейств|настройк|внедрен|включая|уровн|качеств|специалист|функци)`,
  'iu',
);
const SHORT = new Set([
  'и',
  'с',
  'в',
  'на',
  'по',
  'от',
  'для',
  'of',
  'in',
  'and',
  'with',
  'the',
  'ит',
  'it',
]);
const words = (text: string): readonly string[] =>
  text.toLocaleLowerCase().match(/[\p{L}&][\p{L}\p{N}&]*/gu) ?? [];
const MAX_CHARS = 140;

const SKILLS_TAIL = /; навыки: .*$/u;
const isWork = (fact: WorkFact) => /^profile:(?:experience|project|achievement):/u.test(fact.id);
const label = (fact: WorkFact) =>
  (fact.statement.split(';')[0] ?? '').replace(/\s+[—–]\s+/u, ', ').slice(0, 80);

/** A budget counts for a leading IT post with its dates: «budget» in a project says not whose it was. */
function isDatedLeadership(fact: WorkFact): boolean {
  if (!fact.id.startsWith('profile:experience:')) return false;
  const [role = '', when = ''] = fact.statement.split(';');
  const title = role.split(/\s+[—–]\s+/u)[0] ?? '';
  const start = when.split(/\s+–\s+/u)[0]?.trim();
  return isLeadingItTitle(title) && monthIndex(start) !== null;
}

/** The place or project that shows the first area, when every area the line asks is shown. */
export function workShownRole(text: string, facts: readonly WorkFact[]): string | undefined {
  if (text.length > MAX_CHARS || /\d/u.test(text)) return undefined;
  const asked = new Set<(typeof AREAS)[number]>();
  for (const word of words(text)) {
    const found = AREAS.find((item) => item.asked.test(word));
    if (found) asked.add(found);
    else if (!SHORT.has(word) && !PLAIN.test(word)) return undefined;
  }
  if (asked.size === 0) return undefined;
  const work = facts
    .filter(isWork)
    .map((fact) => ({ fact, text: fact.statement.replace(SKILLS_TAIL, '') }));
  const shown = [...asked].map(
    (item) =>
      work.find(
        (entry) =>
          item.shown.test(entry.text) && (item.name !== 'budget' || isDatedLeadership(entry.fact)),
      )?.fact,
  );
  return shown.every(Boolean) ? label(shown[0]!) : undefined;
}

const LEADER_TITLE =
  /(?<!\p{L})(?:head|vp|vice president|director|chief|c[aeitpo]o|cdto|lead|руководител|директор|начальник)/iu;
const IT_TITLE =
  /(?<!\p{L})(?:it|ит|technology|technical|support|cio|cto|engineering|поддержк|информационн|технич)/iu;

export const isLeadingItTitle = (title: string): boolean =>
  LEADER_TITLE.test(title) && IT_TITLE.test(title);

/** Whole years in leading IT places, overlaps merged. Read from «Title — Employer; start – end; …». */
export function leadershipYears(facts: readonly WorkFact[], now: Date): number {
  const today = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans = facts.flatMap((fact): readonly (readonly [number, number])[] => {
    if (!fact.id.startsWith('profile:experience:')) return [];
    const [role = '', when = ''] = fact.statement.split(';');
    const title = role.split(/\s+[—–]\s+/u)[0] ?? '';
    if (!isLeadingItTitle(title)) return [];
    const [from, to] = when.split(/\s+–\s+/u);
    const start = monthIndex(from?.trim());
    const end = /н\. в\./u.test(to ?? '') ? today : monthIndex(to?.trim());
    return start !== null && end !== null && end >= start ? [[start, end + 1] as const] : [];
  });
  return Math.floor(mergedMonths(spans) / 12);
}

const YEARS = /(\d{1,2})\s*(?:[-–—]\s*\d{1,2}|\+)?\s*(?:-?х\s+)?(?:лет|года|год|years?)/iu;
/** Only the post and the term: an industry, a size or a product in the line leaves it to the model. */
const LEADER_ASK =
  /^(?:(?:подтвержд\S+|успешн\S+|обязательн\S+)\s+)?(?:опыт|стаж)(?:\s+работы)?\s*(?:(?:на|в)\s+(?:позиции|должности|роли|аналогичной должности))?\s*(?:руководства\s+)?[«"]?(?:(?:ит|it)[- ]?(?:директор\S*|руководител\S*|отдел\S*|департамент\S*)|директор\S*\s+по\s+(?:ит|it)|руководител\S*\s+(?:ит|it)[- ]?(?:отдел\S*|департамент\S*)?|cio|it director|head of it)[»"]?(?:\s*(?:,|\/|или)\s*(?:cio|cto|it director|head of it))*\s*(?:—|-|–)?\s*(?:от|не менее|более)?\s*\d{1,2}(?:\s*[-–—]\s*\d{1,2})?\s*(?:-?х\s+)?(?:лет|года)\.?$/iu;

/** «Опыт на позиции IT-директора от 5 лет», met by the sum of leading IT places. */
export function leadershipMet(
  text: string,
  facts: readonly WorkFact[],
  now: Date,
): string | undefined {
  const value = text.replace(/\s+/gu, ' ').trim();
  const needed = Number(value.match(YEARS)?.[1] ?? 0);
  if (!needed || !LEADER_ASK.test(value) || leadershipYears(facts, now) < needed) return undefined;
  const top = facts.find(
    (fact) =>
      fact.id.startsWith('profile:experience:') &&
      LEADER_TITLE.test(fact.statement.split(';')[0] ?? ''),
  );
  return top && label(top);
}
