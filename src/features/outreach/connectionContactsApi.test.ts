import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../coach/apiClient';
import {
  deleteCandidateConnectionContact,
  listCandidateConnectionContacts,
  saveCandidateConnectionContact,
} from './connectionContactsApi';

describe('candidate connection contacts API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads saved contacts from the candidate-scoped connection API', async () => {
    const page = {
      items: [],
      total: 0,
      offset: 0,
      limit: 100,
      nextOffset: null,
      linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
    };
    const request = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: page }), { status: 200 }));

    await expect(listCandidateConnectionContacts()).resolves.toEqual(page);
    expect(request).toHaveBeenCalledWith(
      '/api/v1/candidate/connection-contacts?limit=100&offset=0',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('saves a manual contact to the server instead of local storage', async () => {
    const input = {
      fullName: 'Елена Мельникова',
      companyName: 'Вектор Банк',
      roleTitle: 'Продакт-менеджер',
      relationship: 'Работали вместе',
      strength: 'unknown' as const,
      workplaces: [],
      knowsRecruiterIds: [],
    };
    const saved = { ...input, id: 'manual-contact-1', source: 'manual' };
    const request = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: saved }), { status: 201 }));

    await expect(saveCandidateConnectionContact(saved.id, input)).resolves.toMatchObject(saved);
    expect(request).toHaveBeenCalledWith(
      '/api/v1/candidate/connection-contacts/manual-contact-1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(input) }),
    );
  });

  it('deletes a manual contact through the candidate-scoped API', async () => {
    const request = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteCandidateConnectionContact('manual-contact-1')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith('/api/v1/candidate/connection-contacts/manual-contact-1', {
      method: 'DELETE',
    });
  });
});
