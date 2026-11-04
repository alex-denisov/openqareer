/** Deterministic requirement kinds (03.11): soft traits weigh little in the fit percent, pay lines are no requirement. */

const L = '\\p{L}';
const word = (body: string) => new RegExp(`(?<!${L})(?:${body})`, 'iu');
const SOFT_PATTERNS: readonly RegExp[] = [
  word('(?:verbal|written|oral|interpersonal|effective|clear|excellent|strong|good)?\\s*communicat(?:ion|ions|e|ing)(?![a-z]*\\s+(?:infrastructure|systems?|networks?|protocols?|platforms?))'),
  word('коммуникатив|коммуникаци|навыки общения|умение общаться|грамотн\\S* (?:устн|письменн)\\S* реч'),
  word('team\\s?work|team player|collaborat|работа в команде|работать в команде|командн\\S* работ|командн\\S* игрок'),
  word('leadership(?!\\s+experience)|лидерск|лидерство'),
  word('problem[- ]solving|аналитическ\\S* мышлен|решение проблем|решени\\S* задач'),
  word('multi[- ]?tasking|многозадачн'),
  word('attention to detail|detail[- ]oriented|внимательност|внимание к деталям|внимательн\\S* к деталям'),
  word('stress[- ]?(?:resistan|toleran)|work(?:ing)? under pressure|стрессоустойчив|устойчивост\\S* к стрессу'),
  word('adaptab|flexib|гибкост|адаптивност|адаптируем'),
  word('time[- ]management|тайм[- ]?менеджмент|управление временем|умение расставлять приоритеты|prioriti[sz]ation'),
  word('responsib(?:le|ility)|ответственност'),
  word('fast learner|quick learner|willingness to learn|self[- ]motivated|proactive|обучаем|быстро обуча|самомотивац|инициативност|проактивност'),
  word('organi[sz]ational skills|организаторск|емпати|empathy|customer[- ]focus|клиентоориентир'),
];
const YEARS = /\d+\s*\+?\s*(?:years?|yrs?|лет|года?)/iu;
const MAX_SOFT_CHARS = 160;

/** A trait («verbal communication», «стрессоустойчивость»), not a tool, method or years of experience. */
export function isSoftRequirementText(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > MAX_SOFT_CHARS || YEARS.test(value)) return false;
  return SOFT_PATTERNS.some((pattern) => pattern.test(value));
}

const PAY_LABEL = /^\s*(?:pay|salary|compensation|benefits?|perks|schedule|job type|shift|hours|pay range|зарплат\S*|оклад|доход|льготы|график(?: работы)?|условия)\s*(?:[:：].*)?$/iu;
const PAY_LABEL_PREFIX = /^\s*(?:pay|pay range|salary|compensation|benefits?|perks|schedule|job type|зарплат\S*|оклад|график работы)\s*[:：]/iu;
const MONEY_PERIOD = /[$€£]\s?\d[\d,.]*\s*k?(?:\s*(?:[-–—]|to)\s*[$€£]?\s?\d[\d,.]*\s*k?)?\s*(?:\/|per\s+|a\s+|an\s+)\s*(?:year|yr|annum|hour|hr|month|week)|\d[\d\s,.]*\s*(?:₽|руб|р\.|тыс)\S*\s*(?:в месяц|\/мес|на руки|до вычета)?/iu;
const PERK = /(?<!\p{L})(?:ДМС|ДМС\.|health insurance|dental|401\s?\(?k\)?|paid time off|PTO|медицинск\S* страхован|оплачиваем\S* отпуск)(?!\p{L})/iu;

/** Salary, perks and schedule lines say what the employer gives; they are no requirement of the candidate. */
export function isCompensationLine(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (PAY_LABEL.test(value) || PAY_LABEL_PREFIX.test(value)) return true;
  return value.length <= 200 && (MONEY_PERIOD.test(value) || PERK.test(value)) && !/experience|опыт|knowledge|знани/iu.test(value);
}

const LEADING_ROLE = /(?<!\p{L})(?:head of|vice president|VP|director|chief|C[A-Z]O|lead|manager|руководител\S*|директор\S*|начальник\S*|заведующ\S*|управляющ\S*)(?!\p{L})[^,.;\n]{0,50}/iu;
const CLIENT_WORK = /(?<!\p{L})(?:client|customer|stakeholder|executive|board|C-level|клиент\S*|заказчик\S*|руководств\S*|топ-менеджмент\S*|VIP)[^,.;\n]{0,40}/iu;

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (text: string): string =>
  text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/giu, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
const MAX_ROLE_CHARS = 80;
/** One readable line: entities decoded, spaces folded, cut at a word boundary, never mid-word. */
function tidyRole(text: string): string {
  const value = decodeEntities(text).replace(/\s+/gu, ' ').replace(/[\s,;:–—-]+$/u, '').trim();
  if (value.length <= MAX_ROLE_CHARS) return value;
  const cut = value.slice(0, MAX_ROLE_CHARS);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).replace(/[\s,;:–—|(&-]+$/u, '');
}
const CLIENT_REQUIREMENT = /communicat|client|customer|stakeholder|коммуникац|клиент|заказчик|переговор|общени/iu;
const matched = (statement: string, pattern: RegExp): string | undefined => statement.match(pattern)?.[0];

/** Experience fact "Title — Employer; period; ..." -> "Title, Employer". */
function experienceLabel(statement: string): string {
  return tidyRole((statement.split(';')[0] ?? '').replace(/\s+[—–]\s+/u, ', '));
}

interface RoleCandidate { readonly label: string; readonly client: boolean; readonly leading: boolean; readonly experience: boolean; readonly rank: number; readonly team: number }

const C_LEVEL = /(?<!\p{L})C[A-Z]O(?!\p{L})/u;
const TOP_ROLE = /(?<!\p{L})(?:chief|vice president|vp|svp|генеральн\S*)(?!\p{L})/iu;
const SENIOR_ROLE = /(?<!\p{L})(?:head of|director|директор\S*|руководител\S*|начальник\S*)(?!\p{L})/iu;
const TEAM_SIZE = /команда\s+(\d+)/iu;

/** The title before the first `;` says how senior a role is: a description only mentions leading. */
function titleRank(statement: string): number {
  const title = statement.split(';')[0] ?? '';
  if (C_LEVEL.test(title) || TOP_ROLE.test(title)) return 3;
  if (SENIOR_ROLE.test(title)) return 2;
  return LEADING_ROLE.test(title) ? 1 : 0;
}

/** 04.11: «OptiLab AI» came first and stood for leadership, while VP with 250 people sat below it. */
const stronger = (left: RoleCandidate, right: RoleCandidate): number =>
  Number(right.experience) - Number(left.experience) || right.rank - left.rank || right.team - left.team;

function roleCandidate(fact: ImpliedRoleFact): RoleCandidate | undefined {
  if (fact.id === 'profile:headline') return undefined;
  const isExperience = fact.id?.startsWith('profile:experience');
  const leading = matched(fact.statement, LEADING_ROLE);
  const client = matched(fact.statement, CLIENT_WORK);
  if (!leading && !client) return undefined;
  const strength = { client: Boolean(client), leading: Boolean(leading), experience: Boolean(isExperience), rank: titleRank(fact.statement), team: Number(fact.statement.match(TEAM_SIZE)?.[1] ?? 0) };
  if (isExperience) return { label: experienceLabel(fact.statement), ...strength };
  return { label: tidyRole((leading ?? client) as string), ...strength };
}

/** The headline names a role only when no experience fact exists; "A | B ($50M" is cut before the bar and the bracket. */
function headlineRole(fact: ImpliedRoleFact | undefined): string | undefined {
  if (!fact || !matched(fact.statement, LEADING_ROLE)) return undefined;
  const first = decodeEntities(fact.statement).split(/\s+\|\s+/u)[0] ?? '';
  const label = tidyRole(first.replace(/\s*[([{][^)\]}]*$/u, ''));
  return label || undefined;
}

export interface ImpliedRoleFact { readonly id?: string; readonly statement: string }

/**
 * Soft skills follow from experience: a leading role or work with clients and management (03.11).
 * The role comes from experience facts (title and employer): for communication and client
 * requirements the strongest one tied to clients, support or leadership, otherwise the strongest leading one.
 * The profile headline is the last resort, only when there is no experience fact at all.
 */
export function impliedSoftRole(facts: readonly (ImpliedRoleFact | string)[], requirementText = ''): string | undefined {
  const list = facts.map((fact): ImpliedRoleFact => (typeof fact === 'string' ? { statement: fact } : fact));
  const candidates = list.map(roleCandidate).filter((item): item is RoleCandidate => item !== undefined && item.label !== '');
  const wantsClient = CLIENT_REQUIREMENT.test(requirementText);
  const pick = (test: (item: RoleCandidate) => boolean) => candidates.filter(test).sort(stronger)[0]?.label;
  const best = wantsClient ? pick((item) => item.client && item.leading) ?? pick((item) => item.client) ?? pick((item) => item.leading) : pick((item) => item.leading) ?? pick((item) => item.client);
  if (best) return best;
  if (list.some((fact) => fact.id?.startsWith('profile:experience'))) return undefined;
  return headlineRole(list.find((fact) => fact.id === 'profile:headline'));
}
