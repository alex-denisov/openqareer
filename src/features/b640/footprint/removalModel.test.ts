import { describe, expect, it } from 'vitest';
import type { FootprintRiskItem } from '../../../../shared/footprintRisk';
import type { FootprintRemoval } from '../../../../shared/footprintRemoval';
import { checksStatus, removalDock, removalDone, removalNote } from './removalModel';

const item = (patch: Partial<FootprintRiskItem> = {}): FootprintRiskItem => ({
  id: 'r1',
  category: 'personal_data',
  level: 'high',
  levelLabel: 'высокий',
  title: 'Телефон в объявлении',
  detail: 'Доска объявлений',
  url: 'https://board.test/ad/1',
  observedAt: null,
  resolved: false,
  action: null,
  findingId: 'a'.repeat(24),
  mismatch: null,
  ...patch,
});

const REQUESTED = '2026-11-10T09:00:00.000Z';
const CHECKED = '2026-11-11T09:00:00.000Z';

describe('B382: путь удаления находки на f03b', () => {
  it('до письма — «Письмо отправлено», после — проверка этой находки', () => {
    expect(removalDock(item())).toBe('request');
    expect(removalDock(item({ removal: { requestedAt: REQUESTED } }))).toBe('check');
  });

  it('без находки или адреса — повторная проверка всего следа', () => {
    expect(removalDock(item({ findingId: null }))).toBe('rerun');
    expect(removalDock(item({ url: null, removal: { requestedAt: REQUESTED } }))).toBe('rerun');
    expect(removalDock(item({ url: null }))).toBe('request');
  });

  it('строка у кнопки: дата письма, затем итог проверки', () => {
    expect(removalNote(undefined)).toBeNull();
    expect(removalNote({ requestedAt: REQUESTED })).toMatch(/^Письмо отправлено 10\.11$/u);
    expect(
      removalNote({ requestedAt: REQUESTED, checkedAt: CHECKED, result: 'still_there' }),
    ).toMatch(/^Ещё на месте · проверено 11\.11$/u);
    expect(removalNote({ requestedAt: REQUESTED, checkedAt: CHECKED, result: 'unclear' })).toMatch(
      /^Сайт не ответил · проверено 11\.11$/u,
    );
    expect(removalNote({ checkedAt: CHECKED, result: 'removed' })).toBeNull();
  });

  it('удалено — дата проверки для строки над находкой', () => {
    expect(removalDone({ checkedAt: CHECKED, result: 'removed' })).toMatch(/^11\.11$/u);
    expect(removalDone({ checkedAt: CHECKED, result: 'still_there' })).toBeNull();
    expect(removalDone(undefined)).toBeNull();
  });
});

describe('B645 p02: «Проверки и запросы»', () => {
  const risk = (id: string, title: string, removal?: FootprintRemoval): FootprintRiskItem =>
    ({ id, title, removal }) as unknown as FootprintRiskItem;

  it('итог последней проверки и запросы, ещё не закрытые удалением', () => {
    const items = [
      risk('a', 'Телефон из объявления', {
        requestedAt: '2026-11-05T09:00:00.000Z',
        checkedAt: '2026-11-11T09:00:00.000Z',
        result: 'removed',
      }),
      risk('b', 'Фото на чужом профиле', { requestedAt: '2026-11-10T09:00:00.000Z' }),
      risk('c', 'Старый блог', {
        requestedAt: '2026-11-01T09:00:00.000Z',
        checkedAt: '2026-11-03T09:00:00.000Z',
        result: 'still_there',
      }),
      risk('d', 'Профиль на GitHub'),
    ];
    expect(checksStatus(items)).toEqual({
      lastCheck: 'телефон из объявления: удалено',
      requests: [
        { id: 'b', title: 'Фото на чужом профиле', date: '10.11' },
        { id: 'c', title: 'Старый блог', date: '01.11' },
      ],
    });
  });

  it('итог «ещё на месте» и «сайт не ответил»; без запросов — пусто', () => {
    const still = [
      risk('c', 'Старый блог', { checkedAt: '2026-11-03T09:00:00.000Z', result: 'still_there' }),
    ];
    expect(checksStatus(still).lastCheck).toBe('старый блог: ещё на месте');
    const unclear = [
      risk('c', 'Старый блог', { checkedAt: '2026-11-03T09:00:00.000Z', result: 'unclear' }),
    ];
    expect(checksStatus(unclear).lastCheck).toBe('старый блог: сайт не ответил');
    expect(checksStatus([risk('d', 'Профиль на GitHub')])).toEqual({
      lastCheck: null,
      requests: [],
    });
  });
});
