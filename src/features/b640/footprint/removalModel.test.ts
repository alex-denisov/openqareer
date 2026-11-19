import { describe, expect, it } from 'vitest';
import type { FootprintRiskItem } from '../../../../shared/footprintRisk';
import { removalDock, removalDone, removalNote } from './removalModel';

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
