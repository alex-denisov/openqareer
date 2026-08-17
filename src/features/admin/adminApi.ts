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
