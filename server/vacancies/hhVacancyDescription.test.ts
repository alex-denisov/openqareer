import { describe, expect, it, vi } from 'vitest';
import { HhVacancyDescriptionLoader } from './hhVacancyDescription';

const vacancyUrl = 'https://hh.ru/vacancy/9001';
const page =
  '<main><div data-qa="vacancy-description"><p>Полное описание роли</p><ul><li>TypeScript</li></ul></div></main>';

describe('HhVacancyDescriptionLoader', () => {
  it('читает полное описание только по переданной карточке и кеширует результат (без блока навыков -> навыки пустые)', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: page });
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const expected = {
      description: 'Полное описание роли\n\n- TypeScript',
      skills: [],
    };
    await expect(loader.load(vacancyUrl)).resolves.toEqual(expected);
    await expect(loader.load(vacancyUrl)).resolves.toEqual(expected);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(vacancyUrl);
  });

  it('страница с описанием и 3 навыками -> skills длины 3', async () => {
    const pageWithSkills = `
      <main>
        <div data-qa="vacancy-description"><p>Описание вакансии</p></div>
        <div class="bloko-tag-list">
          <div data-qa="skills-element"><span>TypeScript</span></div>
          <div data-qa="skills-element"><span>React</span></div>
          <div data-qa="skills-element"><span>Node.js</span></div>
        </div>
      </main>
    `;
    const transport = vi.fn().mockResolvedValue({ status: 200, body: pageWithSkills });
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const result = await loader.load(vacancyUrl);
    expect(result).toBeDefined();
    expect(result?.description).toBe('Описание вакансии');
    expect(result?.skills).toHaveLength(3);
    expect(result?.skills).toEqual(['TypeScript', 'React', 'Node.js']);
  });

  it('повторяет карточку после TTL отказа, не превращая временную ошибку в вечный кеш', async () => {
    let now = 1_000;
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, body: '' })
      .mockResolvedValueOnce({ status: 200, body: page });
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => now,
      failedCacheTtlMs: 5_000,
      failedCacheJitterMs: 0,
    });

    await expect(loader.load(vacancyUrl)).resolves.toBeUndefined();
    await expect(loader.load(vacancyUrl)).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);

    now += 5_001;
    await expect(loader.load(vacancyUrl)).resolves.toMatchObject({
      description: 'Полное описание роли\n\n- TypeScript',
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('holds other card reads during a provider-refusal backoff', async () => {
    let now = 1_000;
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, body: '' })
      .mockResolvedValueOnce({ status: 200, body: page });
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => now,
      failedCacheTtlMs: 5_000,
      failedCacheJitterMs: 0,
    });

    await expect(loader.load('https://hh.ru/vacancy/9001')).resolves.toBeUndefined();
    await expect(loader.load('https://hh.ru/vacancy/9002')).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);

    now += 5_001;
    await expect(loader.load('https://hh.ru/vacancy/9002')).resolves.toMatchObject({
      description: 'Полное описание роли\n\n- TypeScript',
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent detail reads and preserves the one-second minimum interval', async () => {
    let now = 0;
    const starts: number[] = [];
    const transport = vi.fn(async () => {
      starts.push(now);
      return { status: 200, body: page };
    });
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
      minIntervalMs: 1_000,
      failedCacheJitterMs: 0,
    });

    await loader.load('https://hh.ru/vacancy/9001');
    now = 100;
    await Promise.all([
      loader.load('https://hh.ru/vacancy/9002'),
      loader.load('https://hh.ru/vacancy/9003'),
    ]);

    expect(starts).toEqual([0, 1_000, 2_000]);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('bounds the number of pending detail requests', async () => {
    let release!: (result: { status: number; body: string }) => void;
    const transport = vi.fn(
      () => new Promise<{ status: number; body: string }>((resolve) => (release = resolve)),
    );
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: async () => undefined,
      minIntervalMs: 0,
      maxPendingRequests: 1,
    });

    const first = loader.load('https://hh.ru/vacancy/9001');
    expect(await loader.load('https://hh.ru/vacancy/9002')).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);
    release({ status: 200, body: page });
    await first;
  });
});
