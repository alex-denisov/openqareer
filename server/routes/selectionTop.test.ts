import { expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { SELECTION_LIVENESS_TOP } from '../vacancies/selectionLiveness';
import { topSelectionIds } from './selectionTop';

const item = (id: string, keys: readonly string[]): MatchedVacancyItem =>
  ({
    cluster: {
      id: `cluster-${id}`,
      sources: keys.map((externalId) => ({ sourceId: 's', externalId })),
    },
  }) as unknown as MatchedVacancyItem;

it('B797: в очередь идут все записи склейки, строки — первыми', () => {
  expect(topSelectionIds([item('s:1', ['1', '2']), item('s:3', ['3'])])).toEqual([
    's:1',
    's:3',
    's:2',
  ]);
});

it('B797: склейки не вытесняют строки верха', () => {
  const rows = Array.from({ length: SELECTION_LIVENESS_TOP + 1 }, (_, n) =>
    item(`s:${n}`, [`${n}`, `g${n}`]),
  );
  const ids = topSelectionIds(rows);
  expect(ids).toHaveLength(SELECTION_LIVENESS_TOP * 2);
  expect(ids).not.toContain(`s:${SELECTION_LIVENESS_TOP}`);
});
