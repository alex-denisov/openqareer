import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { VacancyAddressStatus } from './defaultVacancySources';
import type { LinkCheckCensus } from './linkLivenessProbe';

/**
 * B200 срез 1 — здоровье площадки как две разные шкалы.
 *
 * «Отвечает `200`» и «жива» — не одно и то же, а «жива» и «ей можно верить» —
 * тем более. Площадка может исправно отдавать архив прошлогодних объявлений,
 * и площадка может отдавать свежий улов из карточек без работодателя. Обе
 * оценки считаются здесь из наблюдений опроса и нигде не назначаются вручную.
 *
 * Каждое число называет свой знаменатель (правило B192): «свежее 180 дней — 0
 * из 96» читается, а «0 %» врёт про размер выборки.
 */

/** Столько дней держится окно постоянства. */
const CONSISTENCY_WINDOW_DAYS = 30;

/** Столько пустых уловов подряд роняют живость. */
const EMPTY_STREAK_LIMIT = 3;

/** Старше этого площадка называется мёртвой. */
const DEAD_AFTER_DAYS = 180;

/**
 * Меньше этого числа определившихся ссылок приговором не считается. Две
 * снятые вакансии есть у любой живой площадки — объявление закрывают в тот же
 * день, когда нашли человека (B200 срез 2).
 */
const MIN_DECIDED_LINKS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Имена, которыми коннекторы подменяли отсутствующего работодателя. Выдуманное
 * имя — это пустое поле, названное словом: `'Tech Company'` стоял у лент
 * (`rssFeedParser.ts`), `'IT Company'` — у 86 из 96 телеграм-вакансий (B164
 * срез 3), `'Компания не указана'` — у hh.ru. Здоровье обязано считать такую
 * запись неполной, иначе полнота карточки всегда равна 100 %.
 */
const FABRICATED_EMPLOYERS = new Set([
  'tech company',
  'it company',
  'компания не указана',
  'не указано',
  'unknown',
]);

/** Доля, которая всегда печатается вместе со своим знаменателем. */
export interface CountedShare {
  readonly counted: number;
  readonly of: number;
}

/**
 * Перепись одного улова. Считается **до** фильтра свежести движка: пул хранит
 * только 30 дней (`MAX_VACANCY_AGE_DAYS`), поэтому доля «свежее 180 дней» по
 * самому пулу всегда была бы 100 % — тавтология вместо меры.
 */
export interface ReadingCensus {
  readonly total: number;
  readonly fresherThan30Days: number;
  readonly fresherThan90Days: number;
  readonly fresherThan180Days: number;
  readonly withEmployer: number;
  readonly withLink: number;
  readonly withDate: number;
}

/** Что опросы площадки успели про неё установить. */
export interface SourceObservations {
  readonly firstReadingAt: string | null;
  readonly lastReadingAt: string | null;
  readonly lastReadingSucceeded: boolean | null;
  readonly lastNonEmptyReadingAt: string | null;
  readonly consecutiveEmptyReadings: number;
  /** Начало окна постоянства: старше него опросы забываются. */
  readonly windowStartedAt: string | null;
  readonly windowReadings: number;
  readonly windowSuccessful: number;
  /** Перепись последнего непустого улова; `null` — непустого улова не было. */
  readonly census: ReadingCensus | null;
  /** Подлинность: доля неперепечатанных объявлений из дедупликатора B205. */
  readonly authenticity?: {
    readonly originalShare: CountedShare;
    readonly reprintShare: CountedShare;
  } | null;
  /** Состояние вежливого опроса: отступ, retry-after, бюджет и адаптивный интервал (B204). */
  readonly schedule?: import('./politeScheduler').SourceScheduleState | null;
  /** Последний обход ссылок: открываются ли ещё объявления площадки (срез 2). */
  readonly linkCheck?: LinkCheckCensus | null;
}

export function emptySourceObservations(): SourceObservations {
  return {
    firstReadingAt: null,
    lastReadingAt: null,
    lastReadingSucceeded: null,
    lastNonEmptyReadingAt: null,
    consecutiveEmptyReadings: 0,
    windowStartedAt: null,
    windowReadings: 0,
    windowSuccessful: 0,
    census: null,
    authenticity: null,
    schedule: null,
    linkCheck: null,
  };
}

/**
 * Дата в будущем свежести не отменяет. Фильтр пула выбрасывает такие записи
 * (`isVacancyFresh`), и для пула это верно — показывать кандидату объявление,
 * которого ещё нет, нельзя. Но живость отвечает на другой вопрос: «есть ли тут
 * хоть что-то недавнее». Объявление, датированное завтра, чем угодно, но не
 * прошлогодним архивом, не является — а считая его несвежим, перепись
 * объявляла мёртвой живую площадку с расхождением часов.
 */
function isFresherThan(publishedAt: string, days: number, nowMs: number): boolean {
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return false;
  return nowMs - published <= days * DAY_MS;
}

function hasEmployer(vacancy: UnifiedVacancy): boolean {
  const company = vacancy.company?.trim() ?? '';
  return company.length > 0 && !FABRICATED_EMPLOYERS.has(company.toLowerCase());
}

function hasLink(vacancy: UnifiedVacancy): boolean {
  const url = vacancy.url?.trim() ?? '';
  return url.startsWith('http://') || url.startsWith('https://');
}

function hasDate(vacancy: UnifiedVacancy): boolean {
  return !Number.isNaN(Date.parse(vacancy.publishedAt ?? ''));
}

/** Перепись улова: считается по тому, что площадка отдала, до всех фильтров. */
export function censusOfReading(
  vacancies: readonly UnifiedVacancy[],
  nowMs: number = Date.now(),
): ReadingCensus {
  let fresherThan30Days = 0;
  let fresherThan90Days = 0;
  let fresherThan180Days = 0;
  let withEmployer = 0;
  let withLink = 0;
  let withDate = 0;

  for (const vacancy of vacancies) {
    const publishedAt = vacancy.publishedAt ?? '';
    if (isFresherThan(publishedAt, 30, nowMs)) fresherThan30Days += 1;
    if (isFresherThan(publishedAt, 90, nowMs)) fresherThan90Days += 1;
    if (isFresherThan(publishedAt, DEAD_AFTER_DAYS, nowMs)) fresherThan180Days += 1;
    if (hasEmployer(vacancy)) withEmployer += 1;
    if (hasLink(vacancy)) withLink += 1;
    if (hasDate(vacancy)) withDate += 1;
  }

  return {
    total: vacancies.length,
    fresherThan30Days,
    fresherThan90Days,
    fresherThan180Days,
    withEmployer,
    withLink,
    withDate,
  };
}

export interface ReadingRecord {
  readonly succeeded: boolean;
  /** Перепись улова; у неуспешного опроса улова нет. */
  readonly census?: ReadingCensus;
  readonly atMs: number;
}

/**
 * Добавляет один опрос к наблюдениям. Возвращает новую запись — наблюдения
 * никогда не правятся на месте.
 */
export function recordReading(
  previous: SourceObservations,
  reading: ReadingRecord,
): SourceObservations {
  const at = new Date(reading.atMs).toISOString();
  const windowStarted = previous.windowStartedAt ? Date.parse(previous.windowStartedAt) : NaN;
  // Опрос старше окна ничего не говорит о сегодняшнем постоянстве: окно
  // начинается заново, а не тянет вечное среднее.
  const windowExpired =
    Number.isNaN(windowStarted) || reading.atMs - windowStarted > CONSISTENCY_WINDOW_DAYS * DAY_MS;

  const caught = reading.succeeded && (reading.census?.total ?? 0) > 0;

  return {
    firstReadingAt: previous.firstReadingAt ?? at,
    lastReadingAt: at,
    lastReadingSucceeded: reading.succeeded,
    lastNonEmptyReadingAt: caught ? at : previous.lastNonEmptyReadingAt,
    // Провал транспорта — не пустой улов: серию пустых уловов он не удлиняет,
    // потому что про содержимое площадки провал ничего не сообщает.
    consecutiveEmptyReadings: !reading.succeeded
      ? previous.consecutiveEmptyReadings
      : caught
        ? 0
        : previous.consecutiveEmptyReadings + 1,
    windowStartedAt: windowExpired ? at : previous.windowStartedAt,
    windowReadings: (windowExpired ? 0 : previous.windowReadings) + 1,
    windowSuccessful:
      (windowExpired ? 0 : previous.windowSuccessful) + (reading.succeeded ? 1 : 0),
    census: caught && reading.census ? reading.census : previous.census,
  };
}

/**
 * Добавляет обход ссылок к наблюдениям. Перепись улова он не трогает: это
 * разные замеры, и заменять один другим нельзя (B200 срез 2).
 */
export function recordLinkCheck(
  previous: SourceObservations,
  linkCheck: LinkCheckCensus,
): SourceObservations {
  return { ...previous, linkCheck };
}

export type SourceLivenessVerdict =
  | 'never_read'
  | 'unreachable'
  | 'alive'
  | 'fading'
  | 'dead';

export interface SourceLiveness {
  readonly verdict: SourceLivenessVerdict;
  readonly reason: string;
  readonly lastNonEmptyReadingAt: string | null;
  readonly consecutiveEmptyReadings: number;
  readonly fresherThan30Days: CountedShare;
  readonly fresherThan90Days: CountedShare;
  readonly fresherThan180Days: CountedShare;
  /** Обход ссылок: `checkedAt: null` — ссылки ещё ни разу не проверяли. */
  readonly linkCheck: {
    readonly checkedAt: string | null;
    readonly open: number;
    readonly gone: number;
    readonly unknown: number;
    readonly checked: number;
    readonly sampledFrom: number;
  };
}

export type SourceTrustVerdict = 'unknown' | 'trusted' | 'mixed' | 'low';

export interface SourceTrust {
  readonly verdict: SourceTrustVerdict;
  readonly reasons: readonly string[];
  readonly completeness: {
    readonly withEmployer: CountedShare;
    readonly withLink: CountedShare;
    readonly withDate: CountedShare;
  };
  readonly consistency: { readonly successful: CountedShare };
  readonly lawfulness: {
    readonly permitted: boolean;
    readonly addressStatus: SourceAddressRight;
  };
  /** Подлинность: доля неперепечатанных объявлений (B205). */
  readonly authenticity:
    | {
        readonly measured: true;
        readonly originalShare: CountedShare;
        readonly reprintShare: CountedShare;
      }
    | { readonly measured: false; readonly blockedBy?: 'B205' };
}

export interface SourceHealth {
  readonly liveness: SourceLiveness;
  readonly trust: SourceTrust;
}

/**
 * Право читать площадку, установленное пробой B199. `not_established` — не
 * синоним запрета, а честное «мы не измеряли»: доверие такой площадке не
 * выдаётся, потому что выдавать его не на чем.
 */
export type SourceAddressRight = VacancyAddressStatus | 'not_established';

export interface SourceRight {
  readonly addressStatus: SourceAddressRight;
}

/**
 * Право читать площадку установлено только у `live`. Всё остальное — отказ,
 * запрет, потерянный адрес или чужой маршрут — держится fail-closed: доверие
 * без доказанного права не выдаётся.
 */
function isPermitted(addressStatus: SourceAddressRight): boolean {
  return addressStatus === 'live';
}

function share(counted: number, of: number): CountedShare {
  return { counted, of };
}

function olderThanDeadLine(iso: string | null, nowMs: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  return nowMs - at > DEAD_AFTER_DAYS * DAY_MS;
}

/** Один приговор живости: что решено и почему. */
type LivenessCall = Pick<SourceLiveness, 'verdict' | 'reason'>;

/**
 * Приговор по обходу ссылок или `null`, когда обход ничего не доказал: горстка
 * определившихся ссылок приговором не является (B200 срез 2).
 */
function callLivenessByLinks(link: LinkCheckCensus | null): LivenessCall | null {
  if (!link) return null;
  const decided = link.open + link.gone;
  if (decided < MIN_DECIDED_LINKS) return null;
  if (link.open === 0) {
    return {
      verdict: 'dead',
      reason: `Ни одна ссылка не открылась: 0 из ${decided} ответивших о судьбе объявления`,
    };
  }
  if (link.gone > link.open) {
    return {
      verdict: 'fading',
      reason: `Открывается ${link.open} из ${link.checked} проверенных ссылок`,
    };
  }
  return null;
}

function callLiveness(observations: SourceObservations, nowMs: number): LivenessCall {
  const census = observations.census;
  const total = census?.total ?? 0;

  if (observations.lastReadingAt === null) {
    return { verdict: 'never_read', reason: 'Площадку ещё ни разу не опрашивали' };
  }

  if (census && total > 0 && census.fresherThan180Days === 0) {
    return { verdict: 'dead', reason: `Ни одной вакансии свежее 180 дней: 0 из ${total}` };
  }

  if (olderThanDeadLine(observations.lastNonEmptyReadingAt, nowMs)) {
    return {
      verdict: 'dead',
      reason: `Последний непустой улов старше 180 дней (${observations.lastNonEmptyReadingAt})`,
    };
  }

  if (
    observations.lastNonEmptyReadingAt === null &&
    olderThanDeadLine(observations.firstReadingAt, nowMs)
  ) {
    return { verdict: 'dead', reason: 'За 180 дней опросов площадка не отдала ни одной вакансии' };
  }

  const byLinks = callLivenessByLinks(observations.linkCheck ?? null);

  // Лента может исправно отдавать свежие даты у объявлений, которых на сайте
  // уже нет. Ответ `404` — единственное доказательство, что их нет (срез 2).
  if (byLinks?.verdict === 'dead') return byLinks;

  if (observations.lastReadingSucceeded === false) {
    return { verdict: 'unreachable', reason: 'Последний опрос завершился ошибкой' };
  }

  if (byLinks) return byLinks;

  if (observations.consecutiveEmptyReadings >= EMPTY_STREAK_LIMIT) {
    return {
      verdict: 'fading',
      reason: `Улов пуст три опроса подряд (${observations.consecutiveEmptyReadings})`,
    };
  }

  if (census && total > 0 && census.fresherThan30Days === 0) {
    return { verdict: 'fading', reason: `Ни одной вакансии свежее 30 дней: 0 из ${total}` };
  }

  return {
    verdict: 'alive',
    reason: `Свежее 30 дней: ${census?.fresherThan30Days ?? 0} из ${total}`,
  };
}

function describeLiveness(observations: SourceObservations, nowMs: number): SourceLiveness {
  const census = observations.census;
  const total = census?.total ?? 0;
  return {
    ...callLiveness(observations, nowMs),
    lastNonEmptyReadingAt: observations.lastNonEmptyReadingAt,
    consecutiveEmptyReadings: observations.consecutiveEmptyReadings,
    fresherThan30Days: share(census?.fresherThan30Days ?? 0, total),
    fresherThan90Days: share(census?.fresherThan90Days ?? 0, total),
    fresherThan180Days: share(census?.fresherThan180Days ?? 0, total),
    linkCheck: {
      checkedAt: observations.linkCheck?.checkedAt ?? null,
      open: observations.linkCheck?.open ?? 0,
      gone: observations.linkCheck?.gone ?? 0,
      unknown: observations.linkCheck?.unknown ?? 0,
      checked: observations.linkCheck?.checked ?? 0,
      sampledFrom: observations.linkCheck?.sampledFrom ?? 0,
    },
  };
}

/** Ниже этой доли критерий считается проваленным. */
const TRUST_LOW = 0.6;
/** С этой доли критерий считается выполненным. */
const TRUST_GOOD = 0.9;

/**
 * Причины называют, какой критерий не дотянул, и всегда со знаменателем: «10 из
 * 96» читается, «10 %» скрывает размер выборки (правило B192).
 */
function trustShortfalls(
  completeness: SourceTrust['completeness'],
  consistency: SourceTrust['consistency'],
  authenticity: SourceTrust['authenticity'],
  total: number,
  linkCheck: LinkCheckCensus | null,
): { reasons: string[]; worstRatio: number } {
  const criteria = [
    { share: completeness.withEmployer, text: (n: number) => `Работодатель назван у ${n} из ${total} карточек` },
    { share: completeness.withLink, text: (n: number) => `Рабочая ссылка есть у ${n} из ${total} карточек` },
    { share: completeness.withDate, text: (n: number) => `Дата публикации есть у ${n} из ${total} карточек` },
    {
      share: consistency.successful,
      text: (n: number) => `Успешных опросов ${n} из ${consistency.successful.of} за 30 дней`,
    },
  ];

  // Проверенная ссылка — критерий полноты сильнее самой полной карточки:
  // карточка может называть всё, а вести в никуда (B200 срез 2).
  if (linkCheck && linkCheck.checked >= MIN_DECIDED_LINKS) {
    criteria.push({
      share: share(linkCheck.open, linkCheck.checked),
      text: (n: number) => `Открывается ${n} из ${linkCheck.checked} проверенных ссылок`,
    });
  }

  if (authenticity.measured && authenticity.originalShare.of > 0) {
    criteria.push({
      share: authenticity.originalShare,
      text: (n: number) => `Подлинных объявлений ${n} из ${authenticity.originalShare.of}`,
    });
  }

  const reasons: string[] = [];
  let worstRatio = 1;
  for (const criterion of criteria) {
    const ratio = criterion.share.of === 0 ? 1 : criterion.share.counted / criterion.share.of;
    if (ratio < TRUST_GOOD) reasons.push(criterion.text(criterion.share.counted));
    worstRatio = Math.min(worstRatio, ratio);
  }
  return { reasons, worstRatio };
}

function describeTrust(observations: SourceObservations, right: SourceRight): SourceTrust {
  const census = observations.census;
  const total = census?.total ?? 0;
  const completeness = {
    withEmployer: share(census?.withEmployer ?? 0, total),
    withLink: share(census?.withLink ?? 0, total),
    withDate: share(census?.withDate ?? 0, total),
  };
  const consistency = {
    successful: share(observations.windowSuccessful, observations.windowReadings),
  };
  const permitted = isPermitted(right.addressStatus);
  const lawfulness = { permitted, addressStatus: right.addressStatus };
  const authenticity: SourceTrust['authenticity'] = observations.authenticity
    ? {
        measured: true,
        originalShare: observations.authenticity.originalShare,
        reprintShare: observations.authenticity.reprintShare,
      }
    : { measured: false, blockedBy: 'B205' };
  const measured = { completeness, consistency, lawfulness, authenticity };

  const lawfulnessReason = permitted
    ? []
    : [`Право читать площадку не установлено: адрес «${right.addressStatus}»`];

  if (observations.lastReadingAt === null || total === 0) {
    return {
      ...measured,
      verdict: 'unknown',
      reasons: [...lawfulnessReason, 'Непустого улова ещё не было — судить не по чему'],
    };
  }

  const { reasons, worstRatio } = trustShortfalls(
    completeness,
    consistency,
    authenticity,
    total,
    observations.linkCheck ?? null,
  );
  const allReasons = [...lawfulnessReason, ...reasons];
  const verdict: SourceTrustVerdict =
    !permitted || worstRatio < TRUST_LOW ? 'low' : allReasons.length > 0 ? 'mixed' : 'trusted';

  return { ...measured, verdict, reasons: allReasons };
}

export function describeSourceHealth(
  observations: SourceObservations,
  right: SourceRight,
  nowMs: number = Date.now(),
): SourceHealth {
  return {
    liveness: describeLiveness(observations, nowMs),
    trust: describeTrust(observations, right),
  };
}

/** Мёртвую площадку плановый опрос не выбирает: тянуть с неё уже нечего. */
export function isDeadSource(health: SourceHealth): boolean {
  return health.liveness.verdict === 'dead';
}
