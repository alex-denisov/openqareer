import { describe, expect, it } from 'vitest';
import { MatchedPoolSnapshots } from './matchedPoolSnapshot';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * Страницы одного чтения обязаны приходить из одного снимка.
 *
 * Кабинет читает пул шестьюдесятью запросами (PRB-023). Пересчитывать подбор
 * на каждый из них — это, во-первых, шестьдесят проходов по всему пулу
 * (замер на проде `1e2436e`: круг вырос с 1.2 с до 3.4 с, и параллельное
 * чтение съело почти весь выигрыш), а во-вторых — сдвиг смещений, если между
 * страницами прошёл опрос площадок.
 */
describe('MatchedPoolSnapshots', () => {
  const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;

  it('второй запрос того же чтения не пересчитывает подбор', () => {
    const snapshots = new MatchedPoolSnapshots();
    let computed = 0;
    const compute = () => {
      computed += 1;
      return [item('a'), item('b')];
    };
    const first = snapshots.read('cand-1', 'профиль-1', compute);
    const second = snapshots.read('cand-1', 'профиль-1', compute);
    expect(computed).toBe(1);
    expect(second).toBe(first);
  });

  it('изменившийся профиль кандидата считается заново', () => {
    const snapshots = new MatchedPoolSnapshots();
    let computed = 0;
    const compute = () => {
      computed += 1;
      return [item('a')];
    };
    snapshots.read('cand-1', 'профиль-1', compute);
    snapshots.read('cand-1', 'профиль-2', compute);
    expect(computed).toBe(2);
  });

  it('снимок живёт отведённое время, а не вечно', () => {
    let now = 1_000;
    const snapshots = new MatchedPoolSnapshots({ ttlMs: 500, clock: () => now });
    let computed = 0;
    const compute = () => {
      computed += 1;
      return [item('a')];
    };
    snapshots.read('cand-1', 'профиль-1', compute);
    now += 499;
    snapshots.read('cand-1', 'профиль-1', compute);
    expect(computed).toBe(1);
    now += 2;
    snapshots.read('cand-1', 'профиль-1', compute);
    expect(computed).toBe(2);
  });

  it('снимки разных кандидатов не смешиваются', () => {
    const snapshots = new MatchedPoolSnapshots();
    const first = snapshots.read('cand-1', 'профиль', () => [item('a')]);
    const second = snapshots.read('cand-2', 'профиль', () => [item('b')]);
    expect(first[0].cluster.id).toBe('a');
    expect(second[0].cluster.id).toBe('b');
  });

  it('память не растёт без предела: старые снимки вытесняются', () => {
    let now = 0;
    const snapshots = new MatchedPoolSnapshots({ maxEntries: 2, clock: () => now });
    snapshots.read('cand-1', 'профиль', () => [item('a')]);
    now += 1;
    snapshots.read('cand-2', 'профиль', () => [item('b')]);
    now += 1;
    snapshots.read('cand-3', 'профиль', () => [item('c')]);
    expect(snapshots.size).toBe(2);
    let recomputed = 0;
    snapshots.read('cand-1', 'профиль', () => {
      recomputed += 1;
      return [item('a')];
    });
    expect(recomputed).toBe(1);
  });
});
