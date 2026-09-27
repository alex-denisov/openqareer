import { describe, expect, it, vi } from 'vitest';
import { HhVacancyDescriptionLoader } from './hhVacancyDescription';

const vacancyUrl = 'https://hh.ru/vacancy/9001';
const page =
  '<main><div data-qa="vacancy-description"><p>Полное описание роли</p><ul><li>TypeScript</li></ul></div></main>';

describe('HhVacancyDescriptionLoader', () => {
  it('читает полное описание только по переданной карточке и кеширует результат', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: page });
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(loader.load(vacancyUrl)).resolves.toBe('Полное описание роли\n\n- TypeScript');
    await expect(loader.load(vacancyUrl)).resolves.toBe('Полное описание роли\n\n- TypeScript');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(vacancyUrl);
  });

  it('на отказе не выдумывает описание и не повторяет запрос до паузы', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 403, body: '' });
    const loader = new HhVacancyDescriptionLoader({
      transport,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(loader.load(vacancyUrl)).resolves.toBeUndefined();
    await expect(loader.load(vacancyUrl)).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
