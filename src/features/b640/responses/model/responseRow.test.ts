import { describe, expect, it } from 'vitest';
import type { ApplicationView } from '../../../applications/applicationsApi';
import { buildResponseRow, pluralRu, shortDate, dotDate } from './responseRow';
import { application } from './testApplication';

const NOW = new Date('2026-11-12T09:00:00.000Z');

function row(overrides: Partial<ApplicationView>) {
  return buildResponseRow(application(overrides), NOW);
}

describe('B656: строка отклика', () => {
  it('черновик зовёт проверить письмо', () => {
    const view = row({ stage: 'saved', updatedAt: '2026-11-11T10:00:00.000Z' });
    expect(view.tag).toEqual({ tone: 'part', label: 'Черновик' });
    expect(view.next).toBe('Проверьте и отправьте');
    expect(view.event).toBe('черновик сохранён 11.11');
    expect(view.sent).toBe('черновик');
    expect(view.action).toEqual({ kind: 'letter', label: 'Проверить письмо', short: 'Проверить', icon: 'file' });
    expect(view.yours).toBe(true);
  });

  it('недоставленный отклик зовёт повторить', () => {
    const view = row({
      stage: 'applied',
      appliedAt: '2026-11-06T10:00:00.000Z',
      deliveryReceipt: { kind: 'failure_note', value: 'Не доставлено: нужен вход в hh.ru' },
      deliveryReceiptRecordedAt: '2026-11-11T10:00:00.000Z',
    });
    expect(view.tag).toEqual({ tone: 'miss', label: 'не доставлен' });
    expect(view.next).toBe('Отправьте ещё раз');
    expect(view.event).toBe('не доставлен 11.11');
    expect(view.sent).toBe('6 нояб.');
    expect(view.action?.kind).toBe('letter');
    expect(view.failure).toBe('нужен вход в hh.ru');
  });

  it('молчание считает дни и готовит напоминание', () => {
    const view = row({
      stage: 'applied',
      appliedAt: '2026-11-02T10:00:00.000Z',
      followUp: { dueAt: '2026-11-09T00:00:00.000Z', urgency: 'overdue', source: 'standard_schedule', daysSinceContact: 8 },
    });
    expect(view.tag).toEqual({ tone: '', label: 'молчат 8 дней' });
    expect(view.next).toBe('Письмо-напоминание готово');
    expect(view.action).toBeNull();
    expect(view.remind).toBe(true);
  });

  it('свежий отклик ждёт ответа', () => {
    const view = row({ stage: 'applied', appliedAt: '2026-11-10T10:00:00.000Z' });
    expect(view.tag.label).toBe('отправлен');
    expect(view.next).toBe('Ждём ответа');
    expect(view.event).toBe('отправлен 10.11');
    expect(view.yours).toBe(false);
  });

  it('интервью впереди показывает дату и готовность', () => {
    const view = row({
      stage: 'interview',
      stageChangedAt: '2026-11-10T10:00:00.000Z',
      nearestInterview: { id: 'i1', scheduledAt: '2026-11-14T12:00:00.000Z', prepStatus: 'ready', round: 1 },
    });
    expect(view.tag).toEqual({ tone: '', label: 'интервью 14 ноября' });
    expect(view.next).toBe('Подготовка готова');
    expect(view.event).toBe('приглашение 10.11');
  });

  it('прошедшее интервью просит рассказать, как прошло', () => {
    const view = row({
      stage: 'interview',
      whoseTurn: 'candidate',
      nearestInterview: null,
      interviewScheduledAt: ['2026-11-11T12:00:00.000Z'],
    });
    expect(view.tag).toEqual({ tone: 'ok', label: 'интервью прошло' });
    expect(view.next).toBe('Расскажите, как прошло');
    expect(view.event).toBe('интервью 11.11');
  });

  it('оффер показывает срок ответа', () => {
    const view = row({
      stage: 'offer',
      stageChangedAt: '2026-11-10T10:00:00.000Z',
      offer: { applicationId: 'a1', terms: {}, respondBy: '2026-11-14T12:00:00.000Z', createdAt: '', updatedAt: '' },
    });
    expect(view.tag).toEqual({ tone: 'ok', label: 'оффер' });
    expect(view.next).toBe('Ответить до 14 ноября');
    expect(view.action).toEqual({ kind: 'offer', label: 'Ответить на оффер', short: 'Ответить', icon: 'send' });
  });

  it('отказ и архив не требуют действия', () => {
    const rejected = row({ stage: 'rejected', whoseTurn: null, stageChangedAt: '2026-11-09T10:00:00.000Z' });
    expect(rejected.tag.label).toBe('отказ');
    expect(rejected.event).toBe('отказ 9.11');
    const closed = row({
      stage: 'archived',
      whoseTurn: null,
      archiveReason: 'vacancy_closed',
      stageChangedAt: '2026-10-25T10:00:00.000Z',
    });
    expect(closed.tag.label).toBe('вакансия закрыта');
    expect(closed.next).toBe('Без ответа');
    expect(closed.event).toBe('закрыта 25.10');
  });

  it('компания без названия не выдумывается', () => {
    const view = row({ vacancy: { title: 'Аналитик', company: '', url: '', source: 'manual', companyHidden: true } });
    expect(view.company).toBe('Компания скрыта');
  });
});

describe('B656: даты и числа', () => {
  it('форматирует короткую дату и дату события', () => {
    expect(shortDate('2026-11-04T10:00:00.000Z')).toBe('4 нояб.');
    expect(dotDate('2026-11-03T10:00:00.000Z')).toBe('3.11');
    expect(shortDate(null)).toBeNull();
  });

  it('склоняет числительные', () => {
    const forms = ['отклик', 'отклика', 'откликов'] as const;
    expect(pluralRu(1, forms)).toBe('отклик');
    expect(pluralRu(3, forms)).toBe('отклика');
    expect(pluralRu(14, forms)).toBe('откликов');
    expect(pluralRu(21, forms)).toBe('отклик');
  });
});
