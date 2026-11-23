import { presentNotification, type NotificationEventKind } from '../data/notificationPolicy';
import { pluralWordRu } from '../../shared/pluralRu';
import { digestCount, roleDigestTitle, roleInDigestTitle } from './roleVacancyDigest';

/** B671: лента уведомлений нового кабинета поверх прежней таблицы уведомлений. */
export type B640NotificationKind =
  | NotificationEventKind
  | 'interview_invitation'
  | 'offer'
  | 'questionnaire'
  | 'platform_login_required';
export type B640NotificationCategory = 'invitations' | 'responses' | 'vacancies' | 'other';
export type B640NotificationFilter = 'all' | 'invitations' | 'responses' | 'vacancies';

export interface B640Notification {
  readonly id: string;
  readonly kind: B640NotificationKind;
  readonly category: B640NotificationCategory;
  readonly important: boolean;
  readonly title: string;
  readonly company: string | null;
  readonly role: string | null;
  readonly eventAt: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
}

export interface B640NotificationSource {
  readonly id: string;
  readonly kind: NotificationEventKind;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

/** Срез отклика, нужный ленте: компания, роль, стадия, дата интервью и причина сбоя. */
export interface B640ApplicationContext {
  readonly stage: string;
  readonly company: string | null;
  readonly role: string | null;
  readonly interviewAt: string | null;
  readonly failureNote: string | null;
}

export interface B640NotificationFeed {
  readonly items: readonly B640Notification[];
  readonly pinned: readonly B640Notification[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
}

export const B640_PINNED_LIMIT = 3;
const IMPORTANT_KINDS: ReadonlySet<B640NotificationKind> = new Set([
  'delivery_error',
  'platform_login_required',
  'interview_invitation',
  'offer',
]);
const CATEGORY_BY_KIND: Partial<Record<B640NotificationKind, B640NotificationCategory>> = {
  interview_invitation: 'invitations',
  offer: 'invitations',
  questionnaire: 'invitations',
  interview_reminder: 'invitations',
  employer_reply: 'responses',
  employer_opened_letter: 'responses',
  delivery_error: 'responses',
  platform_login_required: 'responses',
  email_approval: 'responses',
  new_vacancies_by_role: 'vacancies',
};
const TITLE_WITH_COMPANY: Partial<Record<B640NotificationKind, (company: string) => string>> = {
  interview_invitation: (company) => `${company} приглашает на интервью`,
  offer: (company) => `${company} прислал оффер`,
  questionnaire: (company) => `${company} просит заполнить анкету`,
  platform_login_required: (company) => `Отклик не доставлен · ${company}`,
  delivery_error: (company) => `Отклик не доставлен · ${company}`,
  employer_reply: (company) => `${company} ответил на отклик`,
  employer_opened_letter: (company) => `${company} прочитал отклик`,
  email_approval: (company) => `${company}: письмо ждёт одобрения`,
};
const TITLE_WITHOUT_COMPANY: Partial<Record<B640NotificationKind, string>> = {
  interview_invitation: 'Вас приглашают на интервью',
  offer: 'Пришёл оффер',
  questionnaire: 'Просят заполнить анкету',
  platform_login_required: 'Отклик не доставлен',
};
/** Причина сбоя — свободный текст пометки; «нужен вход» узнаём по словам. */
const LOGIN_REQUIRED_NOTE = /нужен\s+вход|войдите|войти|авториз|log\s?in|sign\s?in/iu;

function newestReplyIds(rows: readonly B640NotificationSource[]): ReadonlySet<string> {
  const newest = new Map<string, B640NotificationSource>();
  for (const row of rows) {
    if (row.kind !== 'employer_reply' || row.sourceType !== 'application') continue;
    const current = newest.get(row.sourceId);
    const isNewer =
      !current ||
      row.createdAt > current.createdAt ||
      (row.createdAt === current.createdAt && row.id > current.id);
    if (isNewer) newest.set(row.sourceId, row);
  }
  return new Set([...newest.values()].map((row) => row.id));
}

function classifyKind(
  row: B640NotificationSource,
  application: B640ApplicationContext | undefined,
  newestReplies: ReadonlySet<string>,
): B640NotificationKind {
  if (!application) return row.kind;
  if (row.kind === 'employer_reply' && newestReplies.has(row.id)) {
    if (application.stage === 'interview') return 'interview_invitation';
    if (application.stage === 'offer') return 'offer';
  }
  if (row.kind === 'delivery_error' && LOGIN_REQUIRED_NOTE.test(application.failureNote ?? '')) {
    return 'platform_login_required';
  }
  return row.kind;
}

function legacyTitle(kind: B640NotificationKind, row: B640NotificationSource): string {
  const known = TITLE_WITHOUT_COMPANY[kind];
  if (known) return known;
  return presentNotification({ ...row, kind: row.kind }).title;
}

function titleFor(
  kind: B640NotificationKind,
  company: string | null,
  row: B640NotificationSource,
): string {
  const withCompany = company ? TITLE_WITH_COMPANY[kind] : undefined;
  return withCompany && company ? withCompany(company) : legacyTitle(kind, row);
}

function cleaned(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** «Chief Operating Officer и ещё 10» — как роль поиска в «Карьере». */
export function searchRoleLabel(roles: readonly string[]): string | null {
  const named = roles.map((role) => role.trim()).filter(Boolean);
  if (named.length === 0) return null;
  return named.length === 1 ? named[0] : `${named[0]} и ещё ${named.length - 1}`;
}

/** Время события есть только у приглашения; у остальных подпись несёт время записи. */
function eventAtOf(
  kind: B640NotificationKind,
  application: B640ApplicationContext | undefined,
): string | null {
  return kind === 'interview_invitation' ? (application?.interviewAt ?? null) : null;
}

/**
 * B671 (n01b): у подборки за сутки — число и роль в заголовке («6 новых вакансий
 * руководителя разработки»); роль поиска уходит в подпись, только если её нет в заголовке.
 */
function roleDigestView(
  row: B640NotificationSource,
  searchRoles: readonly string[],
): { readonly title: string; readonly role: string | null } | null {
  const count = digestCount(row.sourceType, row.sourceId);
  if (count === null) return null;
  return {
    title: roleDigestTitle(count, searchRoles),
    role: roleInDigestTitle(searchRoles) ? null : searchRoleLabel(searchRoles),
  };
}

/** То, что лента знает о кандидате помимо строки уведомления. */
export interface ClassifyContext {
  readonly searchRoles?: readonly string[];
  /** B671 (n01b): сколько находок в проверке следа этого уведомления. */
  readonly findingCount?: number;
}

/** n01b: «Цифровой след: 1 новая находка». */
export function footprintTitle(count: number | undefined): string {
  if (!count || count < 1) return 'Цифровой след: новые находки';
  const word = pluralWordRu(count, ['новая находка', 'новые находки', 'новых находок']);
  return `Цифровой след: ${count} ${word}`;
}

export function classifyB640Notification(
  row: B640NotificationSource,
  application: B640ApplicationContext | undefined,
  newestReplies: ReadonlySet<string>,
  context: ClassifyContext = {},
): B640Notification {
  const kind = classifyKind(row, application, newestReplies);
  const company = cleaned(application?.company);
  const searchRoles = context.searchRoles ?? [];
  const digest = kind === 'new_vacancies_by_role' ? roleDigestView(row, searchRoles) : null;
  const role =
    kind === 'new_vacancies_by_role'
      ? digest
        ? digest.role
        : searchRoleLabel(searchRoles)
      : cleaned(application?.role);
  return {
    id: row.id,
    kind,
    category: CATEGORY_BY_KIND[kind] ?? 'other',
    important: row.readAt === null && IMPORTANT_KINDS.has(kind),
    title:
      digest?.title ??
      (kind === 'footprint_findings'
        ? footprintTitle(context.findingCount)
        : titleFor(kind, company, row)),
    company,
    role,
    eventAt: eventAtOf(kind, application),
    createdAt: row.createdAt,
    readAt: row.readAt,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
  };
}

export interface BuildB640FeedInput {
  /** Новые первыми, как отдаёт репозиторий. */
  readonly rows: readonly B640NotificationSource[];
  readonly applications: ReadonlyMap<string, B640ApplicationContext>;
  readonly unreadCount: number;
  readonly category: B640NotificationFilter;
  readonly offset: number;
  readonly limit: number;
  /**
   * B671: показ в приложении по ключам «Ответы» и «Приглашения». Задаётся, когда у приглашений
   * свой сохранённый ключ и репозиторий отдал ответы без фильтра по «Ответам».
   */
  readonly inApp?: { readonly replies: boolean; readonly invitations: boolean };
  /** B671: роли поиска кандидата по-русски — для «Новые вакансии по вашей роли». */
  readonly searchRoles?: readonly string[];
  /** B671 (n01b): число находок по id проверки следа. */
  readonly findingCounts?: ReadonlyMap<string, number>;
}

const INVITATION_KINDS: ReadonlySet<B640NotificationKind> = new Set([
  'interview_invitation',
  'offer',
]);

function shownInApp(item: B640Notification, inApp: BuildB640FeedInput['inApp']): boolean {
  if (!inApp) return true;
  if (INVITATION_KINDS.has(item.kind)) return inApp.invitations;
  return item.kind === 'employer_reply' ? inApp.replies : true;
}

export function buildB640NotificationFeed(input: BuildB640FeedInput): B640NotificationFeed {
  const newestReplies = newestReplyIds(input.rows);
  const all = input.rows.map((row) =>
    classifyB640Notification(
      row,
      row.sourceType === 'application' ? input.applications.get(row.sourceId) : undefined,
      newestReplies,
      {
        searchRoles: input.searchRoles ?? [],
        findingCount:
          row.kind === 'footprint_findings' ? input.findingCounts?.get(row.sourceId) : undefined,
      },
    ),
  );
  const classified = all.filter((item) => shownInApp(item, input.inApp));
  const hiddenUnread = all.filter(
    (item) => item.readAt === null && !shownInApp(item, input.inApp),
  ).length;
  const filtered =
    input.category === 'all'
      ? classified
      : classified.filter((item) => item.category === input.category);
  const pinned = filtered
    .filter((item) => item.important)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, B640_PINNED_LIMIT);
  const pinnedIds = new Set(pinned.map((item) => item.id));
  const rest = filtered.filter((item) => !pinnedIds.has(item.id));
  const items = rest.slice(input.offset, input.offset + input.limit);
  const next = input.offset + input.limit;
  return {
    items,
    pinned,
    unreadCount: Math.max(0, input.unreadCount - hiddenUnread),
    nextCursor: next < rest.length ? String(next) : null,
  };
}
