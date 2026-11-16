import type { CandidateMemory, CoachTurnStage } from '../../coach/coachApi';
import {
  QUOTA_PLAN_NAMES,
  type TariffQuotaPlanId,
  type TariffQuotaSummary,
} from '../../tariffs/tariffQuotaApi';
import type { B640Nav } from '../routes';

/** Реплика ленты: то, что нужно панели от сообщения разговора. */
export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

const STAGE_LABEL: Readonly<Record<CoachTurnStage, string>> = {
  today: 'Сегодня',
  profile: 'Профиль',
  career: 'Карьера',
  vacancies: 'Вакансии',
  responses: 'Отклики',
  interviews: 'Интервью',
  diary: 'Дневник',
};

const NAV_STAGE: Readonly<Partial<Record<B640Nav, CoachTurnStage>>> = {
  today: 'today',
  profile: 'profile',
  career: 'career',
  vacancies: 'vacancies',
  responses: 'responses',
  diary: 'diary',
};

/** Тема разговора по разделу кабинета, над которым открыта панель. */
export function stageOfNav(nav: B640Nav | null): CoachTurnStage {
  return (nav && NAV_STAGE[nav]) || 'today';
}

/** «Консультант · Вакансии»; панель без раздела под ней — «Консультант». */
export function panelTitle(stage: CoachTurnStage | null): string {
  return stage ? `Консультант · ${STAGE_LABEL[stage]}` : 'Консультант';
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

export function pendingLabel(count: number): string {
  return `${count} ${plural(count, 'запись ждёт', 'записи ждут', 'записей ждут')} проверки`;
}

/** Записи из разговора, которые ждут решения кандидата. */
export function proposedFacts(memory: readonly CandidateMemory[]): CandidateMemory[] {
  return memory.filter(
    (item) => item.kind === 'fact' && item.status === 'proposed' && !item.sensitive,
  );
}

/**
 * Где в ленте стоит карточка записи: после ответа на сообщение, из которого она взята;
 * ответа ещё нет — сразу после этого сообщения. Записи других разговоров не показываются.
 */
export function factsByMessage(
  messages: readonly ChatMessage[],
  facts: readonly CandidateMemory[],
): Map<string, CandidateMemory[]> {
  const placed = new Map<string, CandidateMemory[]>();
  for (const fact of facts) {
    const sourceIndex = messages.reduce(
      (last, message, index) => (fact.sourceMessageIds.includes(message.id) ? index : last),
      -1,
    );
    if (sourceIndex < 0) continue;
    const reply = messages[sourceIndex + 1];
    const anchor = reply?.role === 'assistant' ? reply : messages[sourceIndex];
    placed.set(anchor.id, [...(placed.get(anchor.id) ?? []), fact]);
  }
  return placed;
}

export interface ConsultantLimit {
  /** «20 ноября»; `null` — дата неизвестна. */
  readonly resetLabel: string | null;
  /** Название тарифа, на который можно перейти; `null` — выше тарифа нет. */
  readonly upgradePlan: string | null;
}

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const HOUR_MINUTE = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

function parseDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Отказ сервера на отправку: тариф, который он назвал для перехода. */
export interface TurnRefusal {
  readonly upgradePlan: TariffQuotaPlanId | null;
}

const PLAN_IDS = Object.keys(QUOTA_PLAN_NAMES);

/** Тариф из ответа сервера: только известные названия. */
export function refusalOf(details: Readonly<Record<string, unknown>>): TurnRefusal {
  const plan = details.upgradePlan;
  const known = typeof plan === 'string' && PLAN_IDS.includes(plan);
  return { upgradePlan: known ? (plan as TariffQuotaPlanId) : null };
}

/** Предел сообщений: по остатку квоты или по отказу сервера на отправку. */
export function limitOf(
  summary: TariffQuotaSummary | null,
  refused: TurnRefusal | null,
): ConsultantLimit | null {
  const quota = summary?.quotas.find((item) => item.key === 'coach_turns');
  const spent = Boolean(summary && !summary.unlimited && quota && quota.remaining <= 0);
  if (!refused && !spent) return null;
  const upgrade = quota?.upgradePlan ?? refused?.upgradePlan ?? null;
  const endsAt = summary?.period ? parseDate(summary.period.endsAt) : null;
  return {
    resetLabel: endsAt ? DAY_MONTH.format(endsAt) : null,
    upgradePlan: upgrade ? QUOTA_PLAN_NAMES[upgrade] : null,
  };
}

/** Строка без разметки ответа: звёздочек, решёток, маркеров списка. */
function plainLine(text: string): string {
  return text
    .replace(/\*+|`+|__/gu, '')
    .replace(/^\s*(?:#{1,6}|[-•]|\d{1,2}[.)])\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Тема разговора одной строкой: первый вопрос кандидата; его нет — первая строка итога.
 * Итог целиком в строку не идёт; по ширине строку обрезает вёрстка.
 */
export function conversationTitle(item: {
  readonly summary: string | null;
  readonly firstPhrase: string;
}): string {
  const lines = [item.firstPhrase, ...(item.summary ?? '').split('\n')].map(plainLine);
  return lines.find((line) => line.length > 0) ?? 'Разговор без темы';
}

/** «Сегодня, 15:02» или «11 ноября». */
export function dayLabel(iso: string, now: Date = new Date()): string | null {
  const date = parseDate(iso);
  if (!date) return null;
  return date.toDateString() === now.toDateString()
    ? `Сегодня, ${HOUR_MINUTE.format(date)}`
    : DAY_MONTH.format(date);
}
