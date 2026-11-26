import { describe, expect, it, vi } from 'vitest';
import { FootprintRequestGate } from './adapters/requestScheduler';
import { recheckFinding } from './findingSourceRecheck';

const gate = () => new FootprintRequestGate({ wait: async () => undefined });
const signal = new AbortController().signal;

const profile = {
  adapter: 'sherlock',
  url: 'https://github.com/msokolova',
  receipt: { method: 'GET', source: 'GitHub', query: 'username=msokolova' },
};
const mention = {
  adapter: 'exa',
  url: 'https://board.example.ru/ad/123',
  receipt: { method: 'POST', source: 'Exa', query: 'Марина Соколова' },
};

function response(status: number, body = ''): Response {
  return new Response(status === 204 ? null : body, { status });
}

describe('«Проверить находку» через источник находки (B382)', () => {
  it('профиль по нику проверяет адаптер площадки: нет профиля — удалено, есть — на месте', async () => {
    const getUrl = vi.fn();
    const gone = await recheckFinding(
      profile,
      { fetch: async () => response(404), requestGate: gate(), getUrl },
      signal,
    );
    expect(gone).toEqual({ result: 'removed', via: 'source' });
    const there = await recheckFinding(
      profile,
      { fetch: async () => response(200), requestGate: gate(), getUrl },
      signal,
    );
    expect(there).toEqual({ result: 'still_there', via: 'source' });
    expect(getUrl).not.toHaveBeenCalled();
  });

  it('упоминание: адрес ещё в выдаче Exa — на месте, без запроса к сайту', async () => {
    const getUrl = vi.fn();
    const exa = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ results: [{ url: 'https://board.example.ru/ad/123', title: 'x' }] }),
          { status: 200 },
        ),
    );
    const result = await recheckFinding(
      mention,
      { exaApiKey: 'k', fetch: exa, requestGate: gate(), getUrl },
      signal,
    );
    expect(result).toEqual({ result: 'still_there', via: 'source' });
    expect(exa).toHaveBeenCalledTimes(1);
    expect(getUrl).not.toHaveBeenCalled();
  });

  it('упоминания нет в выдаче — решает адрес: страница ещё открыта значит на месте', async () => {
    const exa = async () => new Response(JSON.stringify({ results: [] }), { status: 200 });
    const open = await recheckFinding(
      mention,
      { exaApiKey: 'k', fetch: exa, requestGate: gate(), getUrl: async () => 'still_there' },
      signal,
    );
    expect(open).toEqual({ result: 'still_there', via: 'address' });
    const gone = await recheckFinding(
      mention,
      { exaApiKey: 'k', fetch: exa, requestGate: gate(), getUrl: async () => 'removed' },
      signal,
    );
    expect(gone).toEqual({ result: 'removed', via: 'address' });
  });

  it('без ключа Exa, сбой источника или источник без своей проверки — обычный запрос адреса', async () => {
    const getUrl = vi.fn(async () => 'unclear' as const);
    expect(await recheckFinding(mention, { getUrl }, signal)).toEqual({
      result: 'unclear',
      via: 'address',
    });
    const failing = { fetch: async () => response(503), requestGate: gate(), getUrl };
    expect(await recheckFinding(profile, failing, signal)).toEqual({
      result: 'unclear',
      via: 'address',
    });
    const archive = {
      adapter: 'wayback',
      url: 'https://web.archive.org/x',
      receipt: { method: 'GET', source: 'Wayback', query: 'x' },
    };
    expect(await recheckFinding(archive, { getUrl }, signal)).toEqual({
      result: 'unclear',
      via: 'address',
    });
    expect(getUrl).toHaveBeenCalledTimes(3);
  });

  it('у находки нет адреса — проверять нечего', async () => {
    expect(await recheckFinding({ ...profile, url: null }, { getUrl: vi.fn() }, signal)).toBeNull();
  });
});
