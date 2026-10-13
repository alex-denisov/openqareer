import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../coach/apiClient';
import { approveVacancyLetter, getVacancyConnectionCircles } from './vacancyLetterApi';

describe('vacancy letter API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads connection circles through the candidate API with an encoded vacancy id', async () => {
    const response = {
      vacancyId: 'cluster/1',
      companyName: 'Вектор Банк',
      vacancyTitle: 'Head of Platform',
      circles: [],
      linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
    };
    const request = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: response }), { status: 200 }));

    await expect(getVacancyConnectionCircles('cluster/1')).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith(
      '/api/v1/candidate/vacancies/cluster%2F1/connection-circles',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('saves a candidate-approved snapshot without calling a delivery endpoint', async () => {
    const snapshot = {
      circle: 2 as const,
      language: 'en' as const,
      tone: 'technical' as const,
      recipient: { name: 'Sergey B.', role: 'Payments Lead' },
      subject: 'Head of Platform',
      body: 'A fact-backed letter.',
      usedEvidenceIds: ['memory-1'],
      includedWorkplaceIds: [],
    };
    const request = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { applicationId: 'application-1', documentId: 'doc-1', sent: false } }), { status: 201 }),
    );

    await expect(approveVacancyLetter('cluster-1', snapshot)).resolves.toMatchObject({ sent: false });
    expect(request).toHaveBeenCalledWith(
      '/api/v1/candidate/vacancies/cluster-1/letter-approvals',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(snapshot) }),
    );
    expect(request.mock.calls.some(([path]) => String(path).includes('/send'))).toBe(false);
  });
});
