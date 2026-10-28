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

    await expect(loader.load(vacancyUrl)).resolves.toMatchObject({ blocked: 'refused' });
    // Тот же адрес до конца TTL — из кеша отказа этой карточки, без запроса.
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

    await expect(loader.load('https://hh.ru/vacancy/9001')).resolves.toMatchObject({
      blocked: 'refused',
    });
    await expect(loader.load('https://hh.ru/vacancy/9002')).resolves.toMatchObject({
      blocked: 'backoff',
    });
    expect(transport).toHaveBeenCalledTimes(1);

    now += 5_001;
    await expect(loader.load('https://hh.ru/vacancy/9002')).resolves.toMatchObject({
      description: 'Полное описание роли\n\n- TypeScript',
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('403 «employer restricted this vacancy» fails only that card, not the whole platform (prod 28.10)', async () => {
    const forbidden =
      '<template id="HH-Lux-InitialState">{&#34;i18n&#34;:{&#34;applicant.vacancyStatus.forbidden.reason&#34;:&#34;x&#34;},' +
      '&#34;forbidden&#34;:true,&#34;errorPage&#34;:{&#34;isError&#34;:true}}</template>';
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, body: forbidden })
      .mockResolvedValueOnce({ status: 200, body: page });
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => 1_000,
      failedCacheTtlMs: 5_000,
      failedCacheJitterMs: 0,
    });

    await expect(loader.load('https://hh.ru/vacancy/9001')).resolves.toBeUndefined();
    await expect(loader.load('https://hh.ru/vacancy/9002')).resolves.toMatchObject({
      description: 'Полное описание роли\n\n- TypeScript',
    });
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
    expect(await loader.load('https://hh.ru/vacancy/9002')).toMatchObject({ blocked: 'backoff' });
    expect(transport).toHaveBeenCalledTimes(1);
    release({ status: 200, body: page });
    await first;
  });
  // Словарь переводов со строкой «Вакансия в архиве» встроен в каждую страницу
  // hh; признак архива — только статус самой вакансии в данных страницы (B312).
  const TRANSLATIONS = '&#34;vacancy.view.archived.title&#34;:&#34;Вакансия в архиве&#34;';
  const archivedStatus = (value: boolean) =>
    `&#34;status&#34;:{&#34;archived&#34;:${value},&#34;disabled&#34;:false}`;
  const livePage = `<html>${TRANSLATIONS}${archivedStatus(false)}<div data-qa="vacancy-description"><p>Руководить командой</p></div></html>`;

  it('распознаёт страницу вакансии в архиве по статусу вакансии', async () => {
    const loader = new HhVacancyDescriptionLoader({
      transport: async () => ({
        status: 200,
        body: `<html>${TRANSLATIONS}${archivedStatus(true)}</html>`,
      }),
      sleep: async () => {},
    });
    await expect(loader.load('https://hh.ru/vacancy/1')).resolves.toMatchObject({ archived: true });
  });

  it('живая вакансия со словарём переводов не считается архивной', async () => {
    const loader = new HhVacancyDescriptionLoader({
      transport: async () => ({ status: 200, body: livePage }),
      sleep: async () => {},
    });
    const loaded = await loader.load('https://hh.ru/vacancy/2');
    expect(loaded).not.toMatchObject({ archived: true });
    expect(loaded).toMatchObject({ description: expect.stringContaining('Руководить командой') });
  });

  it('a page that fails on its own (404, no description) does not pause other cards', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ status: 404, body: '' })
      .mockResolvedValueOnce({ status: 200, body: '<main>без описания</main>' })
      .mockResolvedValueOnce({ status: 200, body: page });
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => 1_000,
      failedCacheJitterMs: 0,
    });

    await expect(loader.load('https://hh.ru/vacancy/1')).resolves.toBeUndefined();
    await expect(loader.load('https://hh.ru/vacancy/2')).resolves.toBeUndefined();
    await expect(loader.load('https://hh.ru/vacancy/3')).resolves.toMatchObject({
      description: 'Полное описание роли\n\n- TypeScript',
    });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it.each([429, 451])('treats %i as a refusal of the platform', async (status) => {
    const loader = new HhVacancyDescriptionLoader({
      transport: vi.fn().mockResolvedValue({ status, body: '' }),
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => 1_000,
    });
    await expect(loader.load('https://hh.ru/vacancy/1')).resolves.toMatchObject({
      blocked: 'refused',
    });
  });
});
