import { describe, expect, it } from 'vitest';
import {
  judgeLinkOutcome,
  probeVacancyLinks,
  createHttpLinkProbe,
  sampleForLinkCheck,
  type LinkProbeOutcome,
} from './linkLivenessProbe';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';

/**
 * B200 срез 2. Открывается ли ещё ссылка объявления — отдельный замер, и он
 * обязан быть осторожным: стена антибота и молчание сети смертью объявления не
 * являются. Проверки написаны по спецификациям тикета до кода.
 */

const NOW = Date.parse('2026-09-07T09:00:00.000Z');

function card(id: string, overrides: Partial<UnifiedVacancy> = {}): UnifiedVacancy {
  return {
    id,
    fingerprint: id,
    title: 'Инженер',
    company: 'Настоящий работодатель',
    description: 'Описание',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'rss',
      sourceId: 'src-test',
      sourceUrl: `https://example.test/${id}`,
      observedAt: new Date(NOW).toISOString(),
    },
    publishedAt: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
    ...overrides,
  };
}

function cards(count: number): UnifiedVacancy[] {
  return Array.from({ length: count }, (_, index) => card(`v${index + 1}`));
}

describe('B200 · приговор одной ссылке', () => {
  it('считает объявление снятым только на 404 и 410', () => {
    expect(judgeLinkOutcome({ status: 404 }).verdict).toBe('gone');
    expect(judgeLinkOutcome({ status: 410 }).verdict).toBe('gone');
  });

  it('называет ссылку открытой на любом успешном ответе', () => {
    expect(judgeLinkOutcome({ status: 200 }).verdict).toBe('open');
    expect(judgeLinkOutcome({ status: 301 }).verdict).toBe('open');
  });

  it('не хоронит объявление за стеной антибота и за отказом сервера', () => {
    for (const status of [401, 403, 405, 429, 500, 503]) {
      expect(judgeLinkOutcome({ status }).verdict, `status ${status}`).toBe('unknown');
    }
  });

  it('не хоронит объявление за молчанием сети', () => {
    const judged = judgeLinkOutcome({ error: 'ETIMEDOUT' });
    expect(judged.verdict).toBe('unknown');
    expect(judged.reason).toContain('ETIMEDOUT');
  });

  it('называет причину числом ответа, а не машинным кодом', () => {
    expect(judgeLinkOutcome({ status: 404 }).reason).toContain('404');
  });
});

describe('B200 · выборка для проверки ссылок', () => {
  it('берёт записи по всей ленте, а не только начало', () => {
    const sample = sampleForLinkCheck(cards(100), 5);
    expect(sample).toHaveLength(5);
    expect(sample.map((v) => v.id)).toEqual(['v1', 'v21', 'v41', 'v61', 'v81']);
  });

  it('не проверяет записи без ссылки — проверять там нечего', () => {
    const sample = sampleForLinkCheck([card('v1', { url: '' }), card('v2')], 10);
    expect(sample.map((v) => v.id)).toEqual(['v2']);
  });

  it('не ходит по внутренним адресам, пришедшим с чужой площадки', () => {
    const sample = sampleForLinkCheck(
      [
        card('v1', { url: 'http://127.0.0.1:8080/admin' }),
        card('v2', { url: 'http://169.254.169.254/latest/meta-data/' }),
        card('v3', { url: 'http://10.0.0.5/vacancy' }),
        card('v4', { url: 'http://localhost/vacancy' }),
        card('v5', { url: 'file:///etc/passwd' }),
        card('v6'),
      ],
      10,
    );
    expect(sample.map((v) => v.id)).toEqual(['v6']);
  });

  it('отдаёт всё, когда записей меньше выборки', () => {
    expect(sampleForLinkCheck(cards(3), 10)).toHaveLength(3);
  });
});

describe('B200 · обход ссылок площадки', () => {
  it('называет свой знаменатель и из скольких записей взята выборка', async () => {
    const answers: Record<string, LinkProbeOutcome> = {
      'https://example.test/v1': { status: 200 },
      'https://example.test/v21': { status: 404 },
      'https://example.test/v41': { status: 403 },
      'https://example.test/v61': { status: 200 },
      'https://example.test/v81': { status: 410 },
    };
    const { census, goneVacancyIds } = await probeVacancyLinks(
      cards(100),
      async (url) => answers[url] ?? { error: 'unexpected url' },
      { sample: 5, nowMs: NOW },
    );

    expect(census).toMatchObject({
      checkedAt: new Date(NOW).toISOString(),
      open: 2,
      gone: 2,
      unknown: 1,
      checked: 5,
      sampledFrom: 100,
    });
    expect(goneVacancyIds).toEqual(['v21', 'v81']);
  });

  it('не возвращает мёртвыми те записи, чей ответ ничего не доказал', async () => {
    const { census, goneVacancyIds } = await probeVacancyLinks(
      cards(4),
      async () => ({ status: 429 }),
      { sample: 4, nowMs: NOW },
    );
    expect(census.unknown).toBe(4);
    expect(census.gone).toBe(0);
    expect(goneVacancyIds).toEqual([]);
  });

  it('переживает исключение самой пробы, не роняя обход', async () => {
    const { census } = await probeVacancyLinks(
      cards(2),
      async (url) => {
        if (url.endsWith('v1')) throw new Error('socket hang up');
        return { status: 200 };
      },
      { sample: 2, nowMs: NOW },
    );
    expect(census).toMatchObject({ open: 1, unknown: 1, checked: 2 });
  });

  it('не ходит в сеть, когда проверять нечего', async () => {
    let calls = 0;
    const { census } = await probeVacancyLinks(
      [card('v1', { url: '' })],
      async () => {
        calls += 1;
        return { status: 200 };
      },
      { sample: 5, nowMs: NOW },
    );
    expect(calls).toBe(0);
    expect(census).toMatchObject({ checked: 0, sampledFrom: 1 });
  });
});

describe('B200 · проба по сети', () => {
  it('спрашивает только заголовки, а тело не тянет', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const redirects: string[] = [];
    const probe = createHttpLinkProbe({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init?.method });
        redirects.push(String(init?.redirect));
        return new Response(null, { status: 200 });
      },
    });

    expect(await probe('https://example.test/v1')).toEqual({ status: 200 });
    expect(calls).toEqual([{ url: 'https://example.test/v1', method: 'HEAD' }]);
    expect(redirects).toEqual(['manual']);
  });

  it('перепроверяет запросом страницы, когда площадка не принимает HEAD', async () => {
    const methods: string[] = [];
    const probe = createHttpLinkProbe({
      fetchImpl: async (_url, init) => {
        methods.push(init?.method ?? 'GET');
        return new Response(null, { status: methods.length === 1 ? 405 : 200 });
      },
    });

    expect(await probe('https://example.test/v1')).toEqual({ status: 200 });
    expect(methods).toEqual(['HEAD', 'GET']);
  });

  it('называет причину, когда ответа нет вовсе', async () => {
    const probe = createHttpLinkProbe({
      fetchImpl: async () => {
        throw new Error('The operation was aborted due to timeout');
      },
    });

    expect(await probe('https://example.test/v1')).toEqual({
      error: 'The operation was aborted due to timeout',
    });
  });
});
