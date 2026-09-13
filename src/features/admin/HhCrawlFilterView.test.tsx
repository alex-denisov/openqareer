import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HhCrawlFilterView } from './HhCrawlFilterView';
import type { HhCrawlFilter } from './adminApi';

const filter: HhCrawlFilter = {
  categories: [
    {
      id: '11',
      name: 'Информационные технологии',
      roles: [
        { id: '96', name: 'Программист, разработчик' },
        { id: '124', name: 'Тестировщик' },
        { id: '160', name: 'DevOps-инженер' },
      ],
    },
    {
      id: '6',
      name: 'Маркетинг, реклама, PR',
      roles: [{ id: '70', name: 'Маркетолог-аналитик' }],
    },
  ],
  selectedRoleIds: ['96', '124'],
  searchPeriodDays: 30,
  lastFullSweepAt: '2026-09-13T09:00:00.000Z',
};

describe('HhCrawlFilterView', () => {
  it('показывает все категории и роли площадки', () => {
    const html = renderToStaticMarkup(<HhCrawlFilterView filter={filter} />);

    expect(html).toContain('Информационные технологии');
    expect(html).toContain('Маркетинг, реклама, PR');
    expect(html).toContain('Программист, разработчик');
    expect(html).toContain('Маркетолог-аналитик');
  });

  it('отмечает выбранные роли и не отмечает остальные', () => {
    const html = renderToStaticMarkup(<HhCrawlFilterView filter={filter} />);
    // Разбираем тег целиком: порядок атрибутов задаёт React, и опираться на
    // него — значит писать тест про React, а не про экран.
    const checkboxes = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)]
      .map((match) => match[0])
      .map((tag) => ({
        id: /value="([^"]+)"/.exec(tag)?.[1] ?? '',
        checked: tag.includes('checked'),
      }));

    expect(checkboxes.find((c) => c.id === '96')?.checked).toBe(true);
    expect(checkboxes.find((c) => c.id === '124')?.checked).toBe(true);
    expect(checkboxes.find((c) => c.id === '160')?.checked).toBe(false);
    expect(checkboxes.find((c) => c.id === '70')?.checked).toBe(false);
  });

  it('называет, сколько ролей выбрано из скольких', () => {
    const html = renderToStaticMarkup(<HhCrawlFilterView filter={filter} />);

    expect(html).toContain('2 из 4');
  });

  it('называет срок публикации, за который собираются вакансии', () => {
    const html = renderToStaticMarkup(<HhCrawlFilterView filter={filter} />);

    expect(html).toContain('30');
  });

  it('пока фильтр не загружен, чисел не выдумывает', () => {
    const html = renderToStaticMarkup(<HhCrawlFilterView filter={null} />);

    expect(html).not.toContain('из 0');
    expect(html).toContain('Загружаем');
  });

  it('неизвестное время последнего прохода не превращается в дату', () => {
    const html = renderToStaticMarkup(
      <HhCrawlFilterView filter={{ ...filter, lastFullSweepAt: null }} />,
    );

    expect(html).toContain('Полного обхода ещё не было');
  });
});

describe('глубокий обход по требованию', () => {
  it('кнопка «собрать всё заново» есть на экране', () => {
    const html = renderToStaticMarkup(<HhCrawlFilterView filter={filter} />);

    expect(html).toContain('Собрать всё заново');
  });
});
