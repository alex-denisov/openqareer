// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMatchedVacancyPage } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { bindSectionCacheOwner, clearSectionCache } from '../shell/sectionCache';
import { readCachedMatchedPool } from './matchedPoolCache';
import { useMatchedPool, type MatchedPool, type MatchedPoolOptions } from './useMatchedPool';

vi.mock('../coach/coachApi', () => ({
  getMatchedVacancyPage: vi.fn(),
  getMatchedVacancyFacets: vi.fn().mockResolvedValue(undefined),
  getVacancySources: vi.fn().mockResolvedValue([]),
}));

const CARD: MatchedPoolOptions = { pageLimit: 1 };
const TOTAL = 60;
const row = (index: number) => ({ cluster: { id: `v-${index}` } }) as unknown as MatchedVacancyItem;

function serve(): void {
  vi.mocked(getMatchedVacancyPage).mockImplementation(async (offset = 0) => ({
    items: Array.from({ length: 20 }, (_, index) => row(offset + index)),
    total: TOTAL,
    nextOffset: offset + 20 < TOTAL ? offset + 20 : null,
    pageOffsets: [0, 20, 40],
  }));
}

/** Открыть экран: первый кадр и состояние после чтения. */
async function visit(options?: MatchedPoolOptions) {
  const frames: MatchedPool[] = [];
  function Screen() {
    frames.push(useMatchedPool(undefined, options));
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Screen />));
  await act(async () => undefined);
  await act(async () => root.unmount());
  return { first: frames[0]!, last: frames.at(-1)! };
}

describe('кэш подборки: карточка → «Сохранённые» (B770)', () => {
  beforeEach(() => {
    bindSectionCacheOwner('candidate');
    serve();
  });
  afterEach(() => {
    clearSectionCache();
    vi.clearAllMocks();
  });

  it('страница карточки или S07 не показывается «Сохранённым» как готовая подборка', async () => {
    expect((await visit(CARD)).last.matched).toHaveLength(20);
    expect(readCachedMatchedPool()).toBeUndefined();
    const saved = await visit();
    expect(saved.first).toMatchObject({ loading: true, matched: [] });
    expect(saved.last).toMatchObject({ complete: true });
    expect(saved.last.matched).toHaveLength(TOTAL);
  });

  it('карточка не затирает прочитанную до конца подборку', async () => {
    await visit();
    await visit(CARD);
    const saved = await visit();
    expect(saved.first.matched).toHaveLength(TOTAL);
    expect(saved.first).toMatchObject({ complete: true, loading: false });
  });

  it('повторный вход в S07 сразу показывает свою последнюю страницу', async () => {
    await visit(CARD);
    const again = await visit(CARD);
    expect(again.first).toMatchObject({ loading: false, complete: false });
    expect(again.first.matched).toHaveLength(20);
  });
});
