import { apiFetch, readData } from '../coach/apiClient';

/**
 * The administrator directory transport (B089). It mirrors the server record
 * exactly: identity, role and session activity — never career content.
 */
export interface AdminUser {
  id: string;
  username: string;
  role: 'candidate' | 'admin';
  isTest: boolean;
  email: string | null;
  displayName: string | null;
  candidateId: string | null;
  createdAt: string;
  activeSessions: number;
  lastSeenAt: string | null;
}

export interface AdminUserPage {
  total: number;
  users: AdminUser[];
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

export async function listAdminVacancySources(
  signal?: AbortSignal,
): Promise<AdminVacancySource[]> {
  const response = await apiFetch('/api/v1/admin/vacancy-sources', {
    ...(signal ? { signal } : {}),
  });
  return readData<AdminVacancySource[]>(response);
}

export async function syncAdminVacancySource(sourceId: string): Promise<void> {
  await apiFetch(`/api/v1/admin/vacancy-sources/${encodeURIComponent(sourceId)}/sync`, {
    method: 'POST',
  });
}
