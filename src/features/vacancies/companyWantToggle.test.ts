import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getCandidateCompanyPage: vi.fn(),
  setCandidateCompanyWant: vi.fn(),
  setCandidateCompanyWantByName: vi.fn(),
  removeCandidateCompanyWant: vi.fn(),
  listCandidateCompanyWants: vi.fn(),
}));
vi.mock('./candidateCompaniesApi', () => api);

import {
  mergeCompanyRecords,
  toggleCompanyWantByName,
  wantedCompanyRecords,
} from './vacancyScreenCollections';

describe('toggleCompanyWantByName (B422)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('wants a company that is not in the candidate list yet by its name', async () => {
    api.getCandidateCompanyPage.mockResolvedValue({ items: [], total: 0 });
    api.setCandidateCompanyWantByName.mockResolvedValue({ key: 'a'.repeat(24), name: 'NewStore' });
    const record = await toggleCompanyWantByName('NewStore', new Map());
    expect(api.setCandidateCompanyWantByName).toHaveBeenCalledWith('NewStore');
    expect(record).toMatchObject({ key: 'a'.repeat(24), name: 'NewStore', want: true });
  });

  it('removes a known wanted company by key', async () => {
    const known = { key: 'b'.repeat(24), name: 'Гринкод', want: true } as never;
    const record = await toggleCompanyWantByName('Гринкод', new Map([['гринкод', known]]));
    expect(api.removeCandidateCompanyWant).toHaveBeenCalledWith('b'.repeat(24));
    expect(record).toMatchObject({ want: false });
  });

  it('surfaces a failure instead of staying silent', async () => {
    api.getCandidateCompanyPage.mockResolvedValue({ items: [], total: 0 });
    api.setCandidateCompanyWantByName.mockRejectedValue(new Error('Сервис недоступен'));
    await expect(toggleCompanyWantByName('NewStore', new Map())).rejects.toThrow(
      'Сервис недоступен',
    );
  });
});

describe('состояние «Хочу» в строке вакансии (B422)', () => {
  const want = (name: string) => ({
    companyKey: `${name}-key`,
    companyName: name,
    nextStep: null,
    nextStepDueAt: null,
    updatedAt: '2026-10-23T00:00:00Z',
  });

  it('список отметок сразу даёт известную запись с want=true по имени', () => {
    const records = wantedCompanyRecords([want('NewStore')]);
    expect(records.get('newstore')).toMatchObject({
      key: 'NewStore-key',
      name: 'NewStore',
      want: true,
    });
  });

  it('поздний поиск, ничего не нашедший, не стирает отметку', () => {
    const merged = mergeCompanyRecords(
      wantedCompanyRecords([want('NewStore')]),
      new Map([['newstore', null]]),
    );
    expect(merged.get('newstore')).toMatchObject({ want: true });
  });

  it('найденная поиском полная запись заменяет краткую', () => {
    const full = { key: 'NewStore-key', name: 'NewStore', want: true, contactsCount: 3 } as never;
    const merged = mergeCompanyRecords(
      wantedCompanyRecords([want('NewStore')]),
      new Map([['newstore', full]]),
    );
    expect(merged.get('newstore')).toBe(full);
  });
});

describe('список отметок от сервера (B422)', () => {
  it('ответ без массива считается пустым списком, а не роняет экран', async () => {
    vi.resetModules();
    vi.doUnmock('./candidateCompaniesApi');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const real = await import('./candidateCompaniesApi');
    await expect(real.listCandidateCompanyWants()).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});
