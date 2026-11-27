import { describe, expect, it } from 'vitest';
import { application } from '../responses/model/testApplication';
import { responseEvents } from './responseEventsModel';

const NOW = new Date('2026-11-23T10:00:00.000Z');
const failed = (id: string, note: string, recordedAt: string, source = 'hh') =>
  application({
    id,
    vacancy: { title: `Роль ${id}`, company: `Компания ${id}`, url: '', source },
    deliveryReceipt: { kind: 'failure_note', value: note },
    deliveryReceiptRecordedAt: recordedAt,
  });

describe('B650 s05b: «События откликов» — отклики, которые не дошли', () => {
  it('только недоставленные, свежие первыми; заголовок, компания и причина', () => {
    const events = responseEvents(
      [
        application({ id: 'ok' }),
        failed('a', 'Не доставлено: нужен вход в hh.ru', '2026-11-20T10:00:00.000Z'),
        failed('b', 'Не доставлено: вакансия закрыта', '2026-11-22T10:00:00.000Z', 'superjob'),
      ],
      NOW,
    );
    expect(events.map((event) => event.id)).toEqual(['b', 'a']);
    expect(events[1]).toMatchObject({
      tag: 'Не доставлен',
      title: 'Отклик не доставлен',
      company: 'Компания a',
      why: 'Роль a · Нужен вход в hh.ru',
      openPath: '/app/responses/a',
    });
  });

  it('нужен вход в hh.ru — «Войти в hh.ru» в подключения; иначе — «Отправить ещё раз» к письму', () => {
    const [closed, login] = responseEvents(
      [
        failed('a', 'Не доставлено: нужен вход в hh.ru', '2026-11-20T10:00:00.000Z'),
        failed('b', 'Не доставлено: вакансия закрыта', '2026-11-22T10:00:00.000Z', 'superjob'),
      ],
      NOW,
    );
    expect(login.action).toEqual({
      label: 'Войти в hh.ru',
      icon: 'out',
      path: '/app/account/connections',
    });
    expect(closed.action).toEqual({
      label: 'Отправить ещё раз',
      icon: 'send',
      path: '/app/responses/b/letter',
    });
  });

  it('событий нет — пустой список: блок не показывается', () => {
    expect(responseEvents([application()], NOW)).toEqual([]);
  });
});
