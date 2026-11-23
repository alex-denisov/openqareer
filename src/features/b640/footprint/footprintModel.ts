import type { CandidateFootprintAudit } from '../../../../shared/candidateFootprint';
import type {
  FootprintRiskActionKind,
  FootprintRiskItem,
  FootprintRiskLevel,
  FootprintRiskSummary,
} from '../../../../shared/footprintRisk';
import type { IconName } from '../kit';
import type { B640Node } from '../routes';

/** Пункт плана поиска без названия источника: только что и по каким данным ищем. */
export interface PlanItem {
  readonly id: string;
  readonly kind: 'username' | 'email' | 'profile_url' | 'name' | 'work_context';
  readonly preview: string;
  readonly selectedByDefault: boolean;
  readonly available: boolean;
}

/** Одна строка «Данных для поиска»: одинаковые запросы к разным источникам слиты в одну. */
export interface PlanGroup {
  readonly key: string;
  readonly kind: PlanItem['kind'];
  readonly label: string;
  readonly ids: readonly string[];
}

export function planGroups(plan: readonly PlanItem[]): readonly PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const item of plan) {
    if (!item.available) continue;
    const key = `${item.kind}\0${item.preview}`;
    const prev = groups.get(key);
    groups.set(key, prev
      ? { ...prev, ids: [...prev.ids, item.id] }
      : { key, kind: item.kind, label: item.preview, ids: [item.id] });
  }
  return [...groups.values()];
}

export function defaultSelection(plan: readonly PlanItem[]): ReadonlySet<string> {
  return new Set(planGroups(plan)
    .filter((group) => plan.some((item) => group.ids.includes(item.id) && item.selectedByDefault))
    .map((group) => group.key));
}

export function selectedIds(
  groups: readonly PlanGroup[],
  selected: ReadonlySet<string>,
): readonly string[] {
  return groups.filter((group) => selected.has(group.key)).flatMap((group) => group.ids);
}

const KIND_WORD: Readonly<Record<PlanItem['kind'], readonly [string, string]>> = {
  name: ['имя', 'имени'],
  email: ['почта', 'почты'],
  username: ['ник', 'ника'],
  profile_url: ['ссылка', 'ссылки'],
  work_context: ['место работы', 'места работы'],
};
const KIND_ORDER: readonly PlanItem['kind'][] = ['name', 'email', 'username', 'profile_url', 'work_context'];

/** «имя, почта, 2 ссылки» — по чему ищем, без способа поиска. */
export function searchByLine(groups: readonly PlanGroup[], selected: ReadonlySet<string>): string {
  const parts: string[] = [];
  for (const kind of KIND_ORDER) {
    const count = groups.filter((group) => group.kind === kind && selected.has(group.key)).length;
    if (count === 0) continue;
    const [one, many] = KIND_WORD[kind];
    parts.push(count === 1 ? one : `${count} ${many}`);
  }
  return parts.join(', ');
}

/** Доля законченных проверок для полосы ожидания. */
export function auditProgress(audit: CandidateFootprintAudit | null): { done: number; total: number } {
  const statuses = audit?.adapterStatuses.filter((status) => status.state !== 'not_run') ?? [];
  return {
    done: statuses.filter((status) => status.state !== 'pending').length,
    total: Math.max(statuses.length, 1),
  };
}

/** Сколько проверок не прошло: строка ошибки с «Повторить». */
export function failedChecks(audit: CandidateFootprintAudit | null): number {
  if (!audit || audit.state === 'pending') return 0;
  const failed = audit.adapterStatuses.filter((status) => status.state === 'source_error').length;
  return audit.state === 'failed' ? Math.max(failed, 1) : failed;
}

/** Строка сбоя F2б, как в макете: «2 категории не проверены». */
export function uncheckedLine(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} категория не проверена`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} категории не проверены`;
  return `${count} категорий не проверены`;
}

const SHORT_LEVEL: Record<FootprintRiskLevel, string> = {
  high: 'высокий',
  important: 'важно',
  low: 'низкий',
  useful: 'полезно',
};

/** Строка «Риск» находки, как в макете f03b: «высокий: номер находят по имени». */
export function riskLine(
  item: Pick<FootprintRiskItem, 'level' | 'levelLabel' | 'levelReason'>,
): string {
  return item.levelReason ? `${SHORT_LEVEL[item.level]}: ${item.levelReason}` : item.levelLabel;
}

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const SHORT = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });

export function dayMonth(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DAY_MONTH.format(date);
}

export function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : SHORT.format(date);
}

export function findingsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} находка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} находки`;
  return `${count} находок`;
}

/** Цвет метки уровня, как в макете: риск — `part`, низкий — `miss`, полезное — `ok`. */
export function levelTag(level: FootprintRiskLevel | null): string {
  if (level === 'useful') return 'tag ok';
  if (level === 'low') return 'tag miss';
  return 'tag part';
}

export const ACTION_ICON: Readonly<Record<FootprintRiskActionKind, IconName>> = {
  close_account: 'lock',
  check_now: 'flag',
  ask_to_fix: 'edit',
  hide: 'eyeoff',
  add_to_profile: 'plus',
  confirm_owner: 'flag',
  not_mine: 'close',
};

/** Находки, которые ещё стоит разобрать: открытые и не полезные. */
export function openRisks(summary: FootprintRiskSummary): readonly FootprintRiskItem[] {
  return summary.items.filter((item) => !item.resolved && item.level !== 'useful');
}

export function usefulItems(summary: FootprintRiskSummary): readonly FootprintRiskItem[] {
  return summary.items.filter((item) => item.level === 'useful');
}

/** Действия полезной находки: путь удаления у неё не открывается. */
const USEFUL_ACTIONS: ReadonlySet<string> = new Set(['add_to_profile', 'not_mine']);

/** Ведёт ли действие на экран находки f03b (у полезной находки — нет). */
export function opensRemovalPath(item: FootprintRiskItem): boolean {
  return item.action !== null && !USEFUL_ACTIONS.has(item.action.kind);
}

/** «Проверить» ждёт решения кандидата; «стоит убрать» — остальные действия удаления. */
const REVIEW_ACTIONS: ReadonlySet<string> = new Set(['check_now', 'confirm_owner']);

/**
 * B645 f03: главная кнопка — первая находка, которую стоит убрать (как «Убрать телефон» в
 * макете); убирать нечего — первая страница, которую нужно проверить.
 */
export function firstToRemove(
  risks: readonly FootprintRiskItem[],
): FootprintRiskItem | undefined {
  const paths = risks.filter(opensRemovalPath);
  return paths.find((item) => !REVIEW_ACTIONS.has(item.action?.kind ?? '')) ?? paths[0];
}

/**
 * B727: страница по нику — кандидат решает, его ли она. Строка ведёт на f03b (B382: из списка
 * внешних ссылок нет, макет p02), а сама страница открывается уже с f03b.
 */
export function confirmsOwner(item: FootprintRiskItem): boolean {
  return item.action?.kind === 'confirm_owner' && item.url !== null;
}

/** Готовый текст письма владельцу сайта; отправляет сам кандидат. */
export function letterText(item: FootprintRiskItem): string {
  const where = item.url ? ` на странице ${item.url}` : '';
  if (item.mismatch) {
    return `Здравствуйте. ${capitalize(where.trim() || 'на вашем сайте')} указано: ` +
      `${item.mismatch.field} — «${item.mismatch.foundValue}». Это неточно: верно — ` +
      `«${item.mismatch.profileValue}». Прошу исправить и ответить на это письмо.`;
  }
  const what = titleIsSite(item) ? '' : `: ${item.title.toLowerCase()}`;
  return `Здравствуйте. ${capitalize(where.trim() || 'на вашем сайте')} опубликованы мои данные${what}. ` +
    'Прошу удалить их и ответить на это письмо.';
}

/** Заголовок находки — просто адрес сайта: он ничего не говорит о данных. */
function titleIsSite(item: FootprintRiskItem): boolean {
  const title = item.title.trim().toLowerCase().replace(/^www\./u, '');
  if (!item.url) return false;
  try {
    return new URL(item.url).hostname.toLowerCase().replace(/^www\./u, '') === title;
  } catch {
    return false;
  }
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Почтовые программы обрезают длинные адреса mailto: текст письма ограничиваем. */
const MAILTO_BODY_MAX = 1500;

export function mailtoHref(item: FootprintRiskItem): string {
  const subject = item.mismatch ? 'Прошу исправить данные' : 'Прошу удалить мои данные';
  const body = letterText(item).slice(0, MAILTO_BODY_MAX);
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const GOOGLE_REMOVAL_URL = 'https://support.google.com/websearch/answer/12719076';
export const YANDEX_REMOVAL_URL = 'https://yandex.ru/support/abuse/ru/troubleshooting/oblivion.md';

/** Корень страницы: код узла адреса и раздел (их ждёт оболочка), вариант — отдельно. */
export function pageAttrs(node: B640Node, state?: string): Record<string, string> {
  return {
    'data-b640-node': node.code,
    'data-b640-section': node.section,
    ...(state ? { 'data-b640-state': state } : {}),
  };
}
