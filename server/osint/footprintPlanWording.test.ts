import { describe, expect, it } from 'vitest';
import type { PublicFootprintQueryPlanItem } from './candidateFootprintQueryPlan';
import { expandSameWording, mergeSameWording } from './footprintPlanWording';

function item(
  id: string,
  adapterId: PublicFootprintQueryPlanItem['adapterId'],
  preview: string,
  available = true,
): PublicFootprintQueryPlanItem {
  return { id, adapterId, kind: 'username', preview, selectedByDefault: available, available };
}

const NICK = 'Проверить открытые профили под ником «alexey_denisov»';
const CHANNEL = 'Проверить архив публичной страницы https://www.youtube.com/@x';

const plan = [
  item('a1', 'sherlock', NICK),
  item('a2', 'maigret', NICK),
  item('b1', 'wayback', CHANNEL),
  item('b2', 'youtube', CHANNEL, false),
  item('c1', 'exa', 'Искать открытые профили по имени «Мария»'),
];

describe('B668: одна строка плана на одну формулировку', () => {
  it('склеивает строки с одной формулировкой: первая остаётся, доступна, если доступна любая', () => {
    expect(mergeSameWording(plan)).toEqual([
      item('a1', 'sherlock', NICK),
      item('b1', 'wayback', CHANNEL),
      item('c1', 'exa', 'Искать открытые профили по имени «Мария»'),
    ]);
    const onlyYoutubeOn = [item('b1', 'wayback', CHANNEL, false), item('b2', 'youtube', CHANNEL)];
    expect(mergeSameWording(onlyYoutubeOn)).toEqual([
      { ...item('b1', 'wayback', CHANNEL), selectedByDefault: true, available: true },
    ]);
  });

  it('выбранная строка запускает все доступные проверки с той же формулировкой', () => {
    expect(expandSameWording(plan, ['a1', 'b1'])).toEqual(['a1', 'a2', 'b1']);
    expect(expandSameWording(plan, ['c1'])).toEqual(['c1']);
  });

  it('неизвестный и недоступный выбор не теряется: маршрут ответит «план изменился» или «не подключён»', () => {
    expect(expandSameWording(plan, ['zz'])).toEqual(['zz']);
    const off = [item('b1', 'wayback', CHANNEL, false), item('b2', 'youtube', CHANNEL, false)];
    expect(expandSameWording(off, ['b1'])).toEqual(['b1']);
  });
});
