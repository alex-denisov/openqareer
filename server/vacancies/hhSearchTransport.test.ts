import { describe, expect, it } from 'vitest';
import { parseEgressResponse, readEgressConfig } from './hhSearchTransport';

describe('parseEgressResponse', () => {
  it('делит ответ коннектора на код и тело', () => {
    expect(parseEgressResponse('200 12\n\n<html>тело</html>')).toEqual({
      status: 200,
      body: '<html>тело</html>',
    });
  });

  it('отказ коннектора читается как код, а не как пустой успех', () => {
    expect(parseEgressResponse('000 0 host-not-allowed\n\n')).toEqual({ status: 0, body: '' });
  });

  it('обрезанный ответ — отказ, а не пустая страница', () => {
    expect(parseEgressResponse('мусор без заголовка')).toEqual({ status: 0, body: '' });
  });

  it('тело с пустыми строками не обрезается по ним', () => {
    expect(parseEgressResponse('200 5\n\nа\n\nб').body).toBe('а\n\nб');
  });
});

describe('readEgressConfig', () => {
  it('без настроек запасного пути нет — и это не ошибка', () => {
    expect(readEgressConfig({})).toBeNull();
    expect(readEgressConfig({ OPENQAREER_HH_EGRESS_KEY: '/k' })).toBeNull();
  });

  it('читает путь к ключу и узел', () => {
    expect(
      readEgressConfig({
        OPENQAREER_HH_EGRESS_KEY: ' /srv/key ',
        OPENQAREER_HH_EGRESS_TARGET: ' admin@10.0.0.1 ',
      }),
    ).toEqual({ keyPath: '/srv/key', target: 'admin@10.0.0.1' });
  });
});
