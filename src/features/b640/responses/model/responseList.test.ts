import { describe, expect, it } from 'vitest';
import { buildResponseRow } from './responseRow';
import {
  chipCounts,
  markAuto,
  filterRows,
  funnelSummary,
  sortRows,
  timeline,
  type ListedResponse,
} from './responseList';
import { application } from './testApplication';
import type { ApplicationView } from '../../../applications/applicationsApi';

const NOW = new Date('2026-11-12T09:00:00.000Z');

function listed(overrides: Partial<ApplicationView>): ListedResponse {
  const item = application(overrides);
  return { application: item, row: buildResponseRow(item, NOW) };
}

const ITEMS: readonly ListedResponse[] = [
  listed({ id: 'wait', appliedAt: '2026-11-10T10:00:00.000Z', vacancy: { title: 'Б', company: 'Бета', url: '', source: 'hh' } }),
  listed({ id: 'draft', stage: 'saved', vacancy: { title: 'А', company: 'Гринкод', url: '', source: 'linkedin' } }),
  listed({ id: 'offer', stage: 'offer', reachedStages: ['applied', 'responded', 'interview', 'offer'], vacancy: { title: 'В', company: 'Вектор', url: '', source: 'hh' } }),
  listed({ id: 'talk', stage: 'interview', reachedStages: ['applied', 'responded', 'interview'], nearestInterview: { id: 'i', scheduledAt: '2026-11-14T12:00:00.000Z', prepStatus: 'ready', round: 1 } }),
  listed({ id: 'no', stage: 'rejected', whoseTurn: null, reachedStages: ['applied', 'responded'] }),
  listed({ id: 'old', stage: 'archived', whoseTurn: null, appliedAt: '2026-10-02T10:00:00.000Z' }),
];

describe('B656: список откликов', () => {
  it('считает чипы стадий', () => {
    expect(chipCounts(ITEMS)).toEqual({ active: 2, interview: 1, offer: 1, archive: 2, auto: 0 });
  });

  it('фильтрует по выбранным чипам, без выбора показывает всё', () => {
    expect(filterRows(ITEMS, []).length).toBe(6);
    expect(filterRows(ITEMS, ['archive']).map((item) => item.row.id)).toEqual(['no', 'old']);
    expect(filterRows(ITEMS, ['interview', 'offer']).map((item) => item.row.id)).toEqual(['offer', 'talk']);
  });

  it('по умолчанию сверху то, что ждёт кандидата', () => {
    const ids = sortRows(ITEMS, { key: 'next', direction: 'asc' }).map((item) => item.row.id);
    expect(ids.slice(0, 2)).toEqual(['draft', 'offer']);
    expect(ids.slice(-2)).toEqual(['no', 'old']);
  });

  it('сортирует по компании и по дате отклика', () => {
    expect(sortRows(ITEMS, { key: 'company', direction: 'asc' })[0].row.company).toBe('Арка Холдинг');
    expect(sortRows(ITEMS, { key: 'sent', direction: 'desc' })[0].row.id).toBe('wait');
    expect(sortRows(ITEMS, { key: 'sent', direction: 'asc' })[0].row.id).toBe('old');
  });
});

describe('B656: воронка', () => {
  it('считает отправленные без черновиков и молчащие компании', () => {
    const summary = funnelSummary(ITEMS);
    expect(summary.sent).toBe(5);
    expect(summary.responded).toBe(3);
    expect(summary.interview).toBe(2);
    expect(summary.offer).toBe(1);
    expect(summary.silent).toBe(1);
    expect(summary.since).toBe('2 октября');
    expect(summary.sources.map((source) => source.sourceLabel)).toContain('hh.ru');
  });
});

describe('B656: что было', () => {
  it('собирает события с датами, свежие сверху', () => {
    const events = timeline(
      application({
        stage: 'interview',
        stageChangedAt: '2026-11-10T10:00:00.000Z',
        deliveryReceipt: { kind: 'auto_reply', value: 'ok' },
        deliveryReceiptRecordedAt: '2026-11-04T11:00:00.000Z',
        interviewScheduledAt: ['2026-11-11T12:00:00.000Z'],
      }),
      NOW,
    );
    expect(events.map((event) => event.title)).toEqual([
      'Интервью прошло',
      'Приглашение на интервью',
      'Доставлен',
      'Отправлен через hh.ru',
    ]);
    expect(events[0].when).toBe('11 нояб.');
  });

  it('у черновика событий отправки нет', () => {
    expect(timeline(application({ stage: 'saved', appliedAt: null }), NOW)).toEqual([]);
  });
});

describe('B680: автоотклики отдельно', () => {
  const marked = markAuto(ITEMS, new Set(['wait', 'talk']));

  it('отмечает автоотклики по списку сервера и считает их в чипе «Авто»', () => {
    expect(marked.filter((item) => item.auto).map((item) => item.row.id).sort()).toEqual(['talk', 'wait']);
    expect(chipCounts(marked).auto).toBe(2);
  });

  it('«Авто» сужает выбранные стадии, а не добавляет к ним', () => {
    expect(filterRows(marked, ['auto']).map((item) => item.row.id).sort()).toEqual(['talk', 'wait']);
    expect(filterRows(marked, ['auto', 'interview']).map((item) => item.row.id)).toEqual(['talk']);
  });

  it('воронка показывает, сколько отправлено автооткликами', () => {
    expect(funnelSummary(marked).auto).toBe(2);
    expect(funnelSummary(ITEMS).auto).toBe(0);
  });
});
