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
