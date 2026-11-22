import { describe, expect, it, vi } from 'vitest';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { RoleTitleTranslator } from '../providers/roleTitleRuRetry';
import { backfillRoleTitlesRu } from './careerRoleTitleRuBackfill';

function fakeStore(workspace: Partial<CandidateWorkspaceState> | null) {
  let saved = workspace as CandidateWorkspaceState | null;
  return {
    getCandidateWorkspace: () => saved,
    saveCandidateWorkspace: vi.fn((_id: string, next: CandidateWorkspaceState) => {
      saved = next;
      return next;
    }),
    read: () => saved,
  };
}

const campaign = {
  // Chief Technology Officer есть в онтологии, «Директор по ИТ» уже по-русски.
  roles: [
    'IT Operations Director',
    'Chief Technology Officer',
    'Директор по ИТ',
    'Transformation Director',
  ],
  regions: [],
  revision: 3,
  updatedAt: 'x',
  careerRoles: [
    { id: 'r-1', title: 'IT Service Management Director' },
    { id: 'r-2', title: 'AI Consultant', titleRu: 'AI-консультант' },
  ],
};

const translator = (result: Record<string, string>): RoleTitleTranslator => ({
  translateTitles: vi.fn().mockResolvedValue(result),
});

describe('B748: русские названия старых ролей поиска — фоном, один раз', () => {
  it('одна пачка только непереведённых вне онтологии; перевод в кампании и у ролей «Карьеры»', async () => {
    const store = fakeStore({ campaign });
    const translate = translator({
      'IT Operations Director': 'Директор по ИТ-эксплуатации',
      'IT Service Management Director': 'Директор по управлению ИТ-услугами',
    });
    await expect(
      backfillRoleTitlesRu({ candidateStore: store as never, translator: translate }, 'c1'),
    ).resolves.toBe(3);
    expect(translate.translateTitles).toHaveBeenCalledWith([
      'IT Operations Director',
      'Transformation Director',
      'IT Service Management Director',
    ]);
    const next = store.read()!.campaign!;
    expect(next.roleTitlesRu).toEqual({
      'IT Operations Director': 'Директор по ИТ-эксплуатации',
      // Отвергнут — помечен английским, второй раз не спрашиваем.
      'Transformation Director': 'Transformation Director',
    });
    expect(next.careerRoles).toEqual([
      {
        id: 'r-1',
        title: 'IT Service Management Director',
        titleRu: 'Директор по управлению ИТ-услугами',
      },
      { id: 'r-2', title: 'AI Consultant', titleRu: 'AI-консультант' },
    ]);
    // Подбор не пересчитывается: роли и ревизия те же.
    expect(next.roles).toEqual(campaign.roles);
    expect(next.revision).toBe(3);
  });

  it('второй проход ничего не спрашивает и не пишет; отвергнутая роль «Карьеры» тоже помечена', async () => {
    const store = fakeStore({ campaign });
    await backfillRoleTitlesRu(
      { candidateStore: store as never, translator: translator({}) },
      'c1',
    );
    expect(store.read()!.campaign!.roleTitlesRu).toEqual({
      'IT Operations Director': 'IT Operations Director',
      'Transformation Director': 'Transformation Director',
      'IT Service Management Director': 'IT Service Management Director',
    });
    store.saveCandidateWorkspace.mockClear();
    const again = translator({});
    await expect(
      backfillRoleTitlesRu({ candidateStore: store as never, translator: again }, 'c1'),
    ).resolves.toBe(0);
    expect(again.translateTitles).not.toHaveBeenCalled();
    expect(store.saveCandidateWorkspace).not.toHaveBeenCalled();
  });

  it('сбой перевода не пишет — следующий запуск попробует снова; без кампании — ничего', async () => {
    const store = fakeStore({ campaign });
    const failing: RoleTitleTranslator = {
      translateTitles: vi.fn().mockRejectedValue(new Error('503')),
    };
    await expect(
      backfillRoleTitlesRu({ candidateStore: store as never, translator: failing }, 'c1'),
    ).resolves.toBe(0);
    expect(store.saveCandidateWorkspace).not.toHaveBeenCalled();
    const empty = fakeStore({});
    const quiet = translator({});
    await expect(
      backfillRoleTitlesRu({ candidateStore: empty as never, translator: quiet }, 'c1'),
    ).resolves.toBe(0);
    expect(quiet.translateTitles).not.toHaveBeenCalled();
  });
});
