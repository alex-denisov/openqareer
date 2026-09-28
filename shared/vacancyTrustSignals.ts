/**
 * B262: Сигналы доверия к вакансии (фантомные, устаревшие, подозрительные).
 *
 * Анализирует объективные признаки:
 * 1. Живость ссылки (B200): признак `deadLink`, `linkStatus: 'gone'`, `status: 'archived'`.
 * 2. Устаревание и фантомность: открыта >= 60 дней или >= 3 перепубликаций в кластере.
 * 3. Подозрительные условия / скам: финансовые транзакции/обнал/взносы/залоги в тексте.
 * 4. Сомнительные домены: шортенеры или сомнительные зоны (.xyz, .top, .tk и др.).
 */

export type VacancyTrustLevel = 'ok' | 'stale' | 'suspicious';

export interface VacancyTrustSignals {
  readonly level: VacancyTrustLevel;
  readonly reasons: readonly string[];
  readonly deadLink: boolean;
  readonly isStale: boolean;
  readonly isSuspicious: boolean;
}

export interface VacancyTrustInput {
  readonly canonicalTitle?: string;
  readonly canonicalCompany?: string;
  readonly canonicalLocation?: string;
  readonly descriptionSummary?: string;
  readonly primaryUrl?: string;
  readonly firstObservedAt?: string;
  readonly lastSeenAt?: string;
  readonly status?: 'active' | 'archived';
  readonly vacanciesCount?: number;
  readonly deadLink?: boolean;
  readonly linkStatus?: 'open' | 'gone' | 'unknown';
  readonly sources?: readonly {
    readonly sourceType?: string;
    readonly sourceUrl?: string;
  }[];
}

const STALE_THRESHOLD_DAYS = 60;
const PHANTOM_REPOST_THRESHOLD = 3;

const SCAM_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])(обнал|обналичивани[ея]|перевод денег|перевод средств|money mule|wire transfer|crypto transfer)(?:$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(вступительный взнос|страховой взнос|депозит для начала|залог за материалы|залог за оборудование|registration fee|advance deposit|pay to apply)(?:$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(лёгкий заработок|легкий заработок|быстрый доход|доход от \d+ ?[0-9]* ?(?:\$|€|usd|eur|руб) в день|заработок от \d+ ?[0-9]* ?(?:\$|€|usd|eur|руб) в день)(?:$|[^\p{L}\p{N}])/iu,
];

const KNOWN_AGGREGATOR_DOMAINS = [
  'hh.ru',
  'headhunter.ru',
  'remotive.com',
  'remotive.io',
  'linkedin.com',
  'habr.com',
  'career.habr.com',
  'superjob.ru',
  'rabota.ru',
  'zarplata.ru',
  'glassdoor.com',
  'indeed.com',
  'lever.co',
  'greenhouse.io',
  'workable.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'bamboohr.com',
  'personio.de',
  'personio.com',
  'recruitee.com',
  'huntflow.ru',
  'workday.com',
  'myworkdayjobs.com',
  'taleo.net',
  'icims.com',
  'jobvite.com',
  'breezy.hr',
  'join.com',
];

const SHADY_TLDS = ['.xyz', '.top', '.tk', '.ml', '.ga', '.cf', '.gq', '.buzz', '.work', '.click'];
const SUSPICIOUS_DOMAINS = ['telegra.ph', 'bit.ly', 'tinyurl.com', 'clck.ru'];

function parseHostname(urlStr?: string): string | null {
  if (!urlStr) return null;
  try {
    const parsed = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hasScamKeywords(text?: string): boolean {
  if (!text) return false;
  return SCAM_PATTERNS.some((pattern) => pattern.test(text));
}

function isShadyDomain(hostname: string): boolean {
  if (KNOWN_AGGREGATOR_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return false;
  }
  if (SUSPICIOUS_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return true;
  }
  return SHADY_TLDS.some((tld) => hostname.endsWith(tld));
}

export function vacancyTrustSignals(
  vacancy: VacancyTrustInput | null | undefined,
  now: string = '',
): VacancyTrustSignals {
  if (!vacancy) {
    return {
      level: 'ok',
      reasons: [],
      deadLink: false,
      isStale: false,
      isSuspicious: false,
    };
  }

  const reasons: string[] = [];
  let isDead = false;
  let isStale = false;
  let isSuspicious = false;

  // 1. Проверка живости ссылки (B200)
  if (vacancy.deadLink || vacancy.linkStatus === 'gone' || vacancy.status === 'archived') {
    isDead = true;
    isSuspicious = true;
    reasons.push('Ссылка на вакансию недоступна');
  }

  // 2. Проверка текста на признаки скама и сомнительных схем
  if (hasScamKeywords(vacancy.canonicalTitle) || hasScamKeywords(vacancy.descriptionSummary)) {
    isSuspicious = true;
    reasons.push('Признаки сомнительных финансовых условий в описании');
  }

  // 3. Проверка домена публикации
  const hostname = parseHostname(vacancy.primaryUrl);
  if (hostname && isShadyDomain(hostname)) {
    isSuspicious = true;
    reasons.push('Подозрительный домен публикации вакансии');
  }

  // 4. Проверка возраста вакансии (фантомная/зависшая)
  if (vacancy.firstObservedAt) {
    const observedTime = Date.parse(vacancy.firstObservedAt);
    const currentTime = now ? Date.parse(now) : Date.now();
    if (!Number.isNaN(observedTime) && !Number.isNaN(currentTime)) {
      const diffDays = (currentTime - observedTime) / (1000 * 60 * 60 * 24);
      if (diffDays >= STALE_THRESHOLD_DAYS) {
        isStale = true;
        const days = Math.floor(diffDays);
        reasons.push(`Вакансия открыта более 60 дней (${days} дн.)`);
      }
    }
  }

  // 5. Проверка перепубликаций (признак фантомной вакансии)
  const reposts = vacancy.vacanciesCount ?? 1;
  if (reposts >= PHANTOM_REPOST_THRESHOLD) {
    isStale = true;
    reasons.push(`Многократные перепубликации (${reposts} раза, признак фантомной вакансии)`);
  }

  let level: VacancyTrustLevel = 'ok';
  if (isSuspicious) {
    level = 'suspicious';
  } else if (isStale) {
    level = 'stale';
  }

  return {
    level,
    reasons,
    deadLink: isDead,
    isStale,
    isSuspicious,
  };
}
