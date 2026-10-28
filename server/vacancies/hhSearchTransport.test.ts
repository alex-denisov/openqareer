import { describe, expect, it, vi } from 'vitest';
import { directThenFallback, parseEgressResponse, readEgressConfig } from './hhSearchTransport';

describe('directThenFallback', () => {
  const forbidden = '{&#34;forbidden&#34;:true,&#34;errorPage&#34;:{&#34;isError&#34;:true}}';
  it('keeps the direct 403 «employer restricted» page instead of the egress refusal (prod 28.10)', async () => {
    const fallback = vi.fn(async () => ({ status: 403, body: '' }));
    const fetch = directThenFallback(async () => ({ status: 403, body: forbidden }), fallback);
    await expect(fetch('https://hh.ru/vacancy/1')).resolves.toEqual({
      status: 403,
      body: forbidden,
    });
    expect(fallback).not.toHaveBeenCalled();
  });
  it('a bare direct 403 still goes to the egress path', async () => {
    const fallback = vi.fn(async () => ({ status: 200, body: 'page' }));
    const fetch = directThenFallback(async () => ({ status: 403, body: '' }), fallback);
    await expect(fetch('https://hh.ru/vacancy/1')).resolves.toEqual({ status: 200, body: 'page' });
  });
});

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
