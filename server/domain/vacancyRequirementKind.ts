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

/** Soft skills follow from experience: a leading role or work with clients and management (03.11). */
export function impliedSoftRole(statements: readonly string[]): string | undefined {
  for (const pattern of [LEADING_ROLE, CLIENT_WORK]) {
    for (const statement of statements) {
      const match = statement.match(pattern);
      if (match) return match[0].replace(/\s+/gu, ' ').replace(/[\s,;:–—-]+$/u, '').trim();
    }
  }
  return undefined;
}
