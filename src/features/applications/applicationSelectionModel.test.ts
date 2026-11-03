import { describe, expect, it } from 'vitest';
import { selectionApplication } from './applicationSelectionFixture';
import {
  applicationsCsv,
  bulkResultNotice,
  emptyBulkNotice,
  sharedStatus,
} from './applicationSelectionModel';

describe('applicationSelectionModel', () => {
  it('names the status only when every picked response shares it', () => {
    const failed = [selectionApplication('a', { failed: true }), selectionApplication('b', { failed: true })];
    expect(sharedStatus(failed)).toEqual({ tone: 'fail', label: 'Не доставлено' });
    expect(sharedStatus([...failed, selectionApplication('c')])).toBeNull();
    expect(sharedStatus([])).toBeNull();
  });

  it('words the result of each bulk action', () => {
    const result = { state: 'completed', changedCount: 3 } as const;
    expect(bulkResultNotice({ type: 'close' }, result)).toBe('Закрыто 3 откликов.');
    expect(bulkResultNotice({ type: 'label', labelId: 'l1' }, result, 'Приоритет')).toBe(
      'Метка «Приоритет» добавлена откликам: 3.',
    );
    expect(
      bulkResultNotice(
        { type: 'retry' },
        { state: 'prepared', preparedCount: 2, sentCount: 0, changedCount: 2 },
      ),
    ).toBe('В очередь подготовлено 2; отправлено 0.');
    expect(emptyBulkNotice({ type: 'retry' })).toBe('Среди выбранных нет недоставленных откликов.');
  });

  it('exports one CSV row per response and neutralises formula cells', () => {
    const row = selectionApplication('a', { failed: true });
    const csv = applicationsCsv([
      { ...row, vacancy: { ...row.vacancy!, company: '=HYPERLINK("x")' }, labels: [] },
    ]);
    const lines = csv.replace('﻿', '').trim().split('\n');
    expect(lines[0]).toBe('Компания;Роль;Канал;Статус;Отправлено;Срок шага;Метки');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('Не доставлено: резюме скрыто');
  });
});
