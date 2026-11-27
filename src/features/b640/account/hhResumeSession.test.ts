import { beforeEach, describe, expect, it, vi } from 'vitest';

const hh = vi.hoisted(() => ({
  readHhResumes: vi.fn(),
  readHhResumeContent: vi.fn(),
  summaryOf: vi.fn((item: { id: string; title: string }) => ({ id: item.id, title: item.title })),
  getHhResumes: vi.fn(),
  saveHhResumes: vi.fn(),
  readHhResumeFromSession: vi.fn(),
  readSessionPage: vi.fn(),
  persistHhSessionImport: vi.fn(),
}));
vi.mock('../apply/hh/hhDesktop', () => ({
  readHhResumes: hh.readHhResumes,
  readHhResumeContent: hh.readHhResumeContent,
  summaryOf: hh.summaryOf,
}));
vi.mock('../apply/hh/hhSessionApi', () => ({
  getHhResumes: hh.getHhResumes,
  saveHhResumes: hh.saveHhResumes,
}));
vi.mock('../../connections/hhSessionPoll', () => ({
  readHhResumeFromSession: hh.readHhResumeFromSession,
}));
vi.mock('../../connections/connectorSession', () => ({ readSessionPage: hh.readSessionPage }));
vi.mock('../../connections/AccountConnections', () => ({
  persistHhSessionImport: hh.persistHhSessionImport,
}));

import { chooseHhResume, readHhResumeList, refreshHhProfile } from './hhResumeSession';

const resumes = [
  { id: 'r1', title: 'Руководитель разработки', url: 'https://hh.ru/resume/r1' },
  { id: 'r2', title: 'CTO', url: 'https://hh.ru/resume/r2' },
];

beforeEach(() => {
  vi.clearAllMocks();
  hh.readHhResumeFromSession.mockResolvedValue({ rawText: 'резюме' });
});

describe('hhResumeSession', () => {
  it('список: нет входа — «signin», текущее резюме берётся из сохранённого выбора', async () => {
    hh.getHhResumes.mockResolvedValue({ selected: { id: 'r2' } });
    hh.readHhResumes.mockResolvedValueOnce({ kind: 'signed_out' });
    await expect(readHhResumeList()).resolves.toEqual({ kind: 'signin', selectedId: 'r2' });
    hh.getHhResumes.mockRejectedValue(new Error('сеть'));
    hh.readHhResumes.mockResolvedValueOnce({ kind: 'ready', resumes });
    await expect(readHhResumeList()).resolves.toEqual({ kind: 'ready', resumes, selectedId: null });
  });

  it('обновление читает выбранное резюме, без выбора — первое; пустое чтение — сбой', async () => {
    await refreshHhProfile(resumes, 'r2');
    expect(hh.readHhResumeFromSession).toHaveBeenCalledWith(
      'https://hh.ru/resume/r2',
      expect.any(Function),
    );
    expect(hh.persistHhSessionImport).toHaveBeenCalledWith(
      expect.objectContaining({
        parsed: { rawText: 'резюме' },
        sourceUrl: 'https://hh.ru/resume/r2',
      }),
    );
    await refreshHhProfile(resumes, null);
    expect(hh.readHhResumeFromSession).toHaveBeenLastCalledWith(
      'https://hh.ru/resume/r1',
      expect.any(Function),
    );
    hh.readHhResumeFromSession.mockResolvedValueOnce(undefined);
    await expect(refreshHhProfile(resumes, null)).rejects.toThrow('hh_resume_not_read');
    await expect(refreshHhProfile([], null)).rejects.toThrow('hh_resume_not_read');
  });

  it('выбор сохраняет список и содержимое выбранного резюме', async () => {
    hh.readHhResumeContent.mockResolvedValue({
      id: 'r1',
      title: 'Руководитель разработки',
      text: 'т',
    });
    await chooseHhResume(resumes, resumes[0]);
    expect(hh.saveHhResumes).toHaveBeenCalledWith(
      [
        { id: 'r1', title: 'Руководитель разработки' },
        { id: 'r2', title: 'CTO' },
      ],
      { id: 'r1', title: 'Руководитель разработки', text: 'т' },
    );
  });
});
