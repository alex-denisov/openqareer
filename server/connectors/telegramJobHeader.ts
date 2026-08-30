/**
 * Reads the title and the employer out of a Telegram job post.
 *
 * The channels the registry syncs do not label their fields. A post opens with
 * a hashtag line, then names the employer on its own line, then the role — or
 * names the employer inside the title after «в», or never names one at all.
 * The previous reading took the first line as the title (so the candidate read
 * `#middle #офис #москва` as a job title) and wrote the invented employer
 * `IT Company` whenever no `Компания:` label was present — 86 of 96 live
 * vacancies (B164). An employer this module cannot read stays empty; nothing
 * here invents one.
 */

const ROLE_WORD = new RegExp(
  [
    'разработчик', 'программист', 'инженер', 'аналитик', 'дизайнер', 'менеджер',
    'маркетолог', 'таргетолог', 'художник', 'директор', 'тестировщик', 'архитектор',
    'копирайтер', 'редактор', 'рекрутер', 'бухгалтер', 'юрист', 'администратор',
    'специалист', 'консультант', 'продюсер', 'аниматор', 'моделлер', 'геймдизайнер',
    'стажёр', 'стажер', 'продакт',
    '\\b(?:developer|engineer|analyst|designer|manager|marketer|artist|lead|intern)\\b',
    '\\b(?:qa|devops|sre|product|scientist|smm|hr|owner|scrum|sales|producer|architect)\\b',
  ].join('|'),
  'iu',
);

/** Words that follow «в» in a sentence but never name an employer. */
const NOT_AN_EMPLOYER = new RegExp(
  '^(?:команд|компани|штат|проект|стартап|офис|отдел|найм|наш|нашу|связи|поиск|роли|должност)',
  'iu',
);

/**
 * A Russian place name declines after «в» («в Москве»), a company name usually
 * does not («в Яндекс»). An unquoted Cyrillic candidate carrying a prepositional
 * ending is a location, not an employer, so it is refused rather than guessed.
 */
const DECLINED_AFTER_V = /[а-яё]+(?:е|и|у|ю|ах|ях|ье)$/iu;

const MAX_EMPLOYER_LENGTH = 60;

/** A name reads as a name: every word starts with a capital, a digit or a quote. */
function readsLikeAName(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  return words.every((word) => /^[\p{Lu}\d«"“'(]/u.test(word) || word.length <= 2);
}

function isHashtagOnly(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((word) => word.startsWith('#') || !/[\p{L}\p{N}]/u.test(word));
}

function cleanEmployer(raw: string): string {
  const value = raw
    .replace(/[\s.,;:—–-]+$/u, '')
    .replace(/^[\s.,;:—–-]+/u, '')
    .trim();
  if (value.length < 2 || value.length > MAX_EMPLOYER_LENGTH) return '';
  if (NOT_AN_EMPLOYER.test(value)) return '';
  return value;
}

/** `Компания: X` — the one form the channels do label, on its own line or mid-sentence. */
function readLabelledEmployer(lines: string[]): string {
  for (const line of lines) {
    const own = line.match(/^(?:компания|company|работодатель)\s*[:\-—]\s*(.+)$/iu);
    if (own) {
      const value = cleanEmployer(own[1]);
      if (value) return value;
    }
  }
  const inline = lines
    .join(' ')
    .match(/(?:компания|company|работодатель)\s*[:\-—]\s*([^.,;\n]{2,50})/iu);
  return inline ? cleanEmployer(inline[1]) : '';
}

/** A short line with no role word, sitting directly above the role, is the employer. */
function looksLikeEmployerLine(line: string): boolean {
  if (line.endsWith(':') || /^[-–—•*]/u.test(line)) return false;
  if (line.length > MAX_EMPLOYER_LENGTH) return false;
  if (line.split(/\s+/).filter(Boolean).length > 6) return false;
  if (!/[\p{L}]/u.test(line)) return false;
  if (/[!?]$/u.test(line)) return false;
  if (!readsLikeAName(line)) return false;
  return !ROLE_WORD.test(line);
}

function cleanTitle(line: string): string {
  const withoutPrefix = line
    .replace(/^#\S+\s*/u, '')
    .replace(/^вакансия\s*[:—-]?\s*/iu, '')
    .replace(/^(?:ищем|ищу|требуется|нужен|нужна)\s+/iu, '')
    .trim();
  const segments = withoutPrefix
    .split(/(?<=[^\d])\.(?=\s|$)/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const chosen = segments.find((segment) => ROLE_WORD.test(segment)) ?? segments[0] ?? withoutPrefix;
  return chosen.replace(/[\s.,;]+$/u, '').trim();
}

/** `<Role> в <Employer>` — the employer named inside the title itself. */
function splitEmployerOutOfTitle(title: string): { title: string; company: string } {
  const match = title.match(/^(.+?)\s+(?:в|во|at)\s+(.+)$/iu);
  if (!match) return { title, company: '' };

  const head = match[1].trim();
  const tail = match[2].trim();
  // A job title is short. A whole sentence ending in «… в Data Science» is a
  // post about the field, not a vacancy at a company by that name.
  if (head.split(/\s+/).filter(Boolean).length > 6) return { title, company: '' };
  if (!ROLE_WORD.test(head)) return { title, company: '' };

  const quoted = tail.match(/^[«"“'](.+?)[»"”']$/u);
  const candidate = quoted ? quoted[1] : tail;
  const isNamed = quoted
    ? true
    : readsLikeAName(candidate) && !DECLINED_AFTER_V.test(candidate);
  if (!isNamed) return { title, company: '' };

  const company = cleanEmployer(candidate);
  if (!company) return { title, company: '' };
  return { title: head, company };
}

export function extractTelegramJobHeader(rawLines: string[]): { title: string; company: string } {
  const lines = rawLines.map((line) => line.trim()).filter(Boolean);
  const content = lines.filter((line) => !isHashtagOnly(line));

  const labelled = readLabelledEmployer(lines);
  const first = content[0] ?? '';
  const second = content[1] ?? '';

  if (!labelled && first && second && looksLikeEmployerLine(first) && ROLE_WORD.test(second)) {
    return { title: cleanTitle(second), company: cleanEmployer(first) };
  }

  const title = cleanTitle(first) || 'Разработчик';
  if (labelled) return { title, company: labelled };
  return splitEmployerOutOfTitle(title);
}
