import { describe, expect, it } from 'vitest';
import type { ManualApplyItem } from '../../../../../shared/manualApply';
import type { ApplicationView } from '../../../applications/applicationsApi';
import { responseEvents } from '../../today/responseEventsModel';
import { actionPath } from '../ResponsesTable';
import { buildResponseRow } from './responseRow';

const application = {
  id: 'a1',
  stage: 'saved',
  createdAt: '2026-11-25T10:00:00.000Z',
  updatedAt: '2026-11-25T10:00:00.000Z',
  materials: {},
  vacancy: { title: 'Руководитель', company: 'Гринкод', source: 'linkedin' },
} as unknown as ApplicationView;
const item = (over: Partial<ManualApplyItem>): ManualApplyItem => ({
  vacancyId: 'v1',
  applicationId: 'a1',
  title: 'Руководитель',
  company: 'Гринкод',
  url: 'https://www.linkedin.com/jobs/view/1',
  reason: 'linkedin',
  host: 'linkedin.com',
  state: 'ready',
  preparing: false,
  missingAnswers: 0,
  letter: 'Письмо',
  createdAt: '2026-11-25T10:00:00.000Z',
  ...over,
});
const row = (over: Partial<ManualApplyItem>) =>
  buildResponseRow(application, new Date(), { manual: item(over) });

describe('строка «отправить вручную»', () => {
  it('готовый отклик зовёт отправить, с причиной площадки', () => {
    expect(row({})).toMatchObject({ tag: { label: 'готово' }, next: 'Отправить в LinkedIn' });
    expect(actionPath(row({}))).toMatch(/\?step=send$/u);
    expect(row({ reason: 'account_required', host: 'acme.com' }).next).toBe(
      'Нужен аккаунт на acme.com',
    );
    expect(row({ reason: 'sign_in_required', host: 'hh.ru' }).next).toBe('Нужен вход в hh.ru');
  });

  it('вопросы без ответа ведут к анкете, сбор действия не просит', () => {
    const asks = row({ state: 'needs_answer', missingAnswers: 2 });
    expect(asks.next).toBe('2 вопроса без ответа');
    expect(actionPath(asks)).toMatch(/\?step=form$/u);
    expect(row({ state: 'preparing' })).toMatchObject({ action: null, yours: false });
  });

  it('на «Сегодня» попадает готовое, а не то, что собирается', () => {
    const events = (over: Partial<ManualApplyItem>) =>
      responseEvents([application], new Date(), new Map([['a1', item(over)]]));
    expect(events({})).toMatchObject([{ failed: false, company: 'Гринкод' }]);
    expect(events({ state: 'preparing' })).toEqual([]);
  });
});
