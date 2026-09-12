import { apiFetch, readData } from '../coach/apiClient';

export type SubscriptionTier = 'free' | 'pro' | 'executive' | 'enterprise';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface AdminUser {
  id: string;
  username: string;
  role: 'candidate' | 'admin';
  isTest: boolean;
  email: string | null;
  displayName: string | null;
  headline: string | null;
  location: string | null;
  workMode: string | null;
  candidateId: string | null;
  blockedAt: string | null;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: string | null;
  subscriptionNotes: string | null;
  createdAt: string;
  activeSessions: number;
  lastSeenAt: string | null;
}

export interface AdminUserPage {
  total: number;
  users: AdminUser[];
}

export interface AdminAuditRecord {
  id: string;
  actorUserId: string;
  actorUsername: string;
  action: string;
  subjectUserId: string | null;
  subjectUsername: string | null;
  detail: string | null;
  createdAt: string;
}

export interface AdminAuditPage {
  total: number;
  records: AdminAuditRecord[];
}

export interface AdminVacancy {
  id: string;
  fingerprint: string;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  salary?: {
    from?: number;
    to?: number;
    currency: string;
    gross?: boolean;
  };
  description: string;
  requiredSkills: string[];
  employmentType?: string;
  experienceLevel?: string;
  responsibilities?: string[];
  qualifications?: string[];
  niceToHave?: string[];
  benefits?: string[];
  aboutCompany?: string;
  contactInfo?: string;
  fullDescription?: string;
  postType?: 'vacancy' | 'candidate_resume' | 'ad' | 'digest';
  url: string;
  provenance: {
    sourceType: string;
    sourceId: string;
    sourceUrl?: string;
    channelName?: string;
    observedAt: string;
  };
  publishedAt: string;
  status: 'active' | 'archived' | 'expired';
}

/**
 * Краткий вид записи: полный текст поста маршрут не доносит — ответ рвался на
 * 20 220 байтах при любом `limit` (INC-032). Разделы читает карточка.
 */
export interface AdminVacancySummary {
  id: string;
  fingerprint: string;
  title: string;
  company: string;
  location?: string;
  isRemote?: boolean;
  salary?: AdminVacancy['salary'];
  descriptionSnippet: string;
  requiredSkills: string[];
  skillCount: number;
  employmentType?: string;
  experienceLevel?: string;
  postType?: AdminVacancy['postType'];
  url: string;
  provenance: AdminVacancy['provenance'];
  publishedAt: string;
  status: AdminVacancy['status'];
}

export interface AdminVacancyPage {
  total: number;
  items: AdminVacancySummary[];
  statsBySource: Array<{ sourceId: string; sourceName: string; count: number }>;
  offset: number;
  /** Смещение следующей страницы; `null` — выборка кончилась. */
  nextOffset: number | null;
}

/** Доля всегда едет со своим знаменателем: «10 из 96», а не «10 %» (B192). */
export interface AdminCountedShare {
  counted: number;
  of: number;
}

/**
 * Здоровье площадки — две разные шкалы (B200). «Жива» отвечает на вопрос,
 * приходит ли с неё свежий улов; «доверие» — можно ли верить тому, что пришло.
 */
export interface AdminSourceHealth {
  liveness: {
    verdict: 'never_read' | 'unreachable' | 'alive' | 'fading' | 'dead';
    reason: string;
    lastNonEmptyReadingAt: string | null;
    consecutiveEmptyReadings: number;
    fresherThan30Days: AdminCountedShare;
    fresherThan90Days: AdminCountedShare;
    fresherThan180Days: AdminCountedShare;
    /**
     * Обход ссылок объявлений (B200 срез 2). Поля нет у сервера, который ещё
     * не умеет обходить ссылки, — экран обязан это назвать словами, а не нулём.
     */
    linkCheck?: {
      checkedAt: string | null;
      open: number;
      gone: number;
      unknown: number;
      checked: number;
      sampledFrom: number;
    };
  };
  trust: {
    verdict: 'unknown' | 'trusted' | 'mixed' | 'low';
    reasons: string[];
    completeness: {
      withEmployer: AdminCountedShare;
      withLink: AdminCountedShare;
      withDate: AdminCountedShare;
    };
    consistency: { successful: AdminCountedShare };
    lawfulness: { permitted: boolean; addressStatus: string };
    /** Подлинность приходит из кросс-источникового сведения B205. */
    authenticity:
      | {
          measured: true;
          originalShare: AdminCountedShare;
          reprintShare: AdminCountedShare;
        }
      | { measured: false; blockedBy: 'B205' };
  };
}

/**
 * Расписание площадки (B204): когда её опросят и почему не раньше. Сводка
 * короткая — тот же маршрут уже рвался на 20 220 байтах (INC-032).
 */
export interface AdminSourceSchedule {
  due: boolean;
  nextInMin: number | null;
  intervalMin: number;
  crawlDelaySec: number | null;
  robots: 'allowed' | 'disallowed' | 'unconfirmed';
  hourly: number;
  hourlyMax: number;
  failures: number;
  reason: string;
}

export interface AdminVacancySource {
  id: string;
  name: string;
  type: 'hh' | 'remotive' | 'telegram' | 'rss' | 'career_site' | 'direct';
  enabled: boolean;
  targetUrl: string;
  refreshIntervalMinutes: number;
  lastSyncAt?: string;
  lastStatus?: 'healthy' | 'degraded' | 'error';
  lastErrorMessage?: string;
  itemsFoundTotal: number;
  itemsActiveTotal: number;
  /** Отсутствует у площадки, которую этот сервер ещё ни разу не опрашивал. */
  health?: AdminSourceHealth;
  schedule?: AdminSourceSchedule;
}

export interface VacancySourceTestItem {
  id: string;
  title: string;
  company: string;
  location: string;
  salary?: { from?: number; to?: number; currency?: string };
  description?: string;
  requiredSkills?: string[];
  url: string;
  publishedAt?: string;
}

export interface VacancySourceTestResult {
  sourceId: string;
  sourceName: string;
  type: string;
  success: boolean;
  latencyMs: number;
  count: number;
  vacancies: VacancySourceTestItem[];
  message?: string;
}

export const ADMIN_PAGE_SIZE = 25;

export async function listAdminUsers(input: {
  query?: string;
  offset?: number;
  signal?: AbortSignal;
}): Promise<AdminUserPage> {
  const params = new URLSearchParams({
    limit: String(ADMIN_PAGE_SIZE),
    offset: String(input.offset ?? 0),
  });
  const query = input.query?.trim();
  if (query) params.set('query', query);
  const response = await apiFetch(`/api/v1/admin/users?${params.toString()}`, {
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return readData<AdminUserPage>(response);
}

export async function updateAdminUser(
  userId: string,
  input: {
    role?: 'candidate' | 'admin';
    email?: string | null;
    displayName?: string | null;
    headline?: string | null;
    location?: string | null;
    workMode?: 'office' | 'hybrid' | 'remote' | 'flexible' | null;
    subscriptionTier?: SubscriptionTier;
    subscriptionStatus?: SubscriptionStatus;
    subscriptionExpiresAt?: string | null;
    subscriptionNotes?: string | null;
  },
): Promise<AdminUser> {
  const response = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readData<AdminUser>(response);
}

export async function blockAdminUser(
  userId: string,
  blocked: boolean,
): Promise<AdminUser> {
  const response = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocked }),
  });
  return readData<AdminUser>(response);
}

export async function resetAdminUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  await apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  });
}

export async function impersonateAdminUser(
  userId: string,
): Promise<{ redirectUrl: string; user: unknown }> {
  const response = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/impersonate`, {
    method: 'POST',
  });
  return readData<{ redirectUrl: string; user: unknown }>(response);
}

export async function deleteAdminUser(userId: string): Promise<void> {
  await apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export async function listAdminAudit(input?: {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<AdminAuditPage> {
  const params = new URLSearchParams({
    limit: String(input?.limit ?? 50),
    offset: String(input?.offset ?? 0),
  });
  const response = await apiFetch(`/api/v1/admin/audit?${params.toString()}`, {
    ...(input?.signal ? { signal: input.signal } : {}),
  });
  return readData<AdminAuditPage>(response);
}

export async function listAdminVacancies(input?: {
  sourceId?: string;
  type?: string;
  query?: string;
  isRemote?: boolean;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<AdminVacancyPage> {
  const params = new URLSearchParams({
    limit: String(input?.limit ?? 20),
    offset: String(input?.offset ?? 0),
  });
  if (input?.sourceId) params.set('sourceId', input.sourceId);
  if (input?.type) params.set('type', input.type);
  if (input?.query?.trim()) params.set('query', input.query.trim());
  if (input?.isRemote !== undefined) params.set('isRemote', String(input.isRemote));

  const response = await apiFetch(`/api/v1/admin/vacancies?${params.toString()}`, {
    ...(input?.signal ? { signal: input.signal } : {}),
  });
  return readData<AdminVacancyPage>(response);
}

/** Полная запись для модального окна: список её больше не везёт (INC-032). */
export async function getAdminVacancy(
  vacancyId: string,
  signal?: AbortSignal,
): Promise<AdminVacancy> {
  const response = await apiFetch(`/api/v1/admin/vacancies/${encodeURIComponent(vacancyId)}`, {
    ...(signal ? { signal } : {}),
  });
  return readData<AdminVacancy>(response);
}

interface AdminVacancySourcePage {
  items: AdminVacancySource[];
  total: number;
  offset: number;
  nextOffset: number | null;
}

/**
 * Реестр со здоровьем площадок весит около 30 КБ, а прод рвёт тело ответа на
 * 20 220 байтах (INC-032). Экран собирает список страницами, пока маршрут не
 * скажет, что выборка кончилась: остановиться на первой странице значило бы
 * молча потерять две трети площадок.
 */
export async function listAdminVacancySources(
  signal?: AbortSignal,
): Promise<AdminVacancySource[]> {
  const collected: AdminVacancySource[] = [];
  let offset: number | null = 0;

  while (offset !== null) {
    const response = await apiFetch(
      `/api/v1/admin/vacancy-sources?offset=${offset}`,
      { ...(signal ? { signal } : {}) },
    );
    const page: AdminVacancySourcePage = await readData<AdminVacancySourcePage>(response);
    collected.push(...page.items);
    // Страница, не сдвинувшая смещение, вернула бы нас сюда навсегда.
    offset = page.nextOffset !== null && page.nextOffset > offset ? page.nextOffset : null;
  }

  return collected;
}

export async function syncAllAdminVacancySources(): Promise<{ success: boolean; count: number }> {
  const response = await apiFetch('/api/v1/admin/vacancy-sources/sync-all', {
    method: 'POST',
  });
  return readData<{ success: boolean; count: number }>(response);
}

export async function syncAdminVacancySource(sourceId: string): Promise<void> {
  await apiFetch(`/api/v1/admin/vacancy-sources/${encodeURIComponent(sourceId)}/sync`, {
    method: 'POST',
  });
}

export async function testAdminVacancySource(
  sourceId: string,
  input?: { query?: string },
): Promise<VacancySourceTestResult> {
  const response = await apiFetch(
    `/api/v1/admin/vacancy-sources/${encodeURIComponent(sourceId)}/test`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
    },
  );
  return readData<VacancySourceTestResult>(response);
}
