import { describe, expect, it } from 'vitest';
import { MEASURED_ATS_BOARDS } from './atsBoards';
import { atsFeedId } from './atsFamilies';
import {
  ATS_BOARDS_PER_DAY,
  ATS_ROLLOUT_START_MS,
  FREEHIRE_FEED_SOURCES,
  atsRolloutAdmits,
} from './freehireFeeds';
import { MultiSourceVacancyEngine } from '../multiSourceVacancyEngine';

const DAY = 86_400_000;
const idAt = (i: number) =>
  FREEHIRE_FEED_SOURCES.find((s) => s.id.endsWith(atsFeedId(MEASURED_ATS_BOARDS[i])))!.id;

describe('B641: порция досок ATS по смене суток UTC', () => {
  it('допускает следующую порцию на следующие сутки', () => {
    const first = idAt(ATS_BOARDS_PER_DAY);
    expect(atsRolloutAdmits(first, ATS_ROLLOUT_START_MS + DAY / 2)).toBe(false);
    expect(atsRolloutAdmits(first, ATS_ROLLOUT_START_MS + DAY)).toBe(true);
    expect(atsRolloutAdmits('src-fh-sber', ATS_ROLLOUT_START_MS)).toBeUndefined();
  });

  it('движок включает доску на смене суток без перезапуска, ручное выключение не трогает', async () => {
    const waiting = idAt(ATS_BOARDS_PER_DAY);
    const manual = idAt(ATS_BOARDS_PER_DAY + 1);
    const sources = [waiting, manual].map((id) => ({
      ...FREEHIRE_FEED_SOURCES.find((s) => s.id === id)!,
      enabled: false,
    }));
    const engine = new MultiSourceVacancyEngine({ sources, fetcher: async () => [] });
    const enabled = (id: string) => engine.getSources().find((s) => s.id === id)?.enabled;
    await engine.syncDue(ATS_ROLLOUT_START_MS + DAY / 2);
    engine.toggleSource(manual, false);
    expect(enabled(waiting)).toBe(false);
    await engine.syncDue(ATS_ROLLOUT_START_MS + DAY + 60_000);
    expect(enabled(waiting)).toBe(true);
    expect(enabled(manual)).toBe(false);
  });
});
