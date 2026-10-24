import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VacancyMapView } from './VacancyMapView';

vi.mock('./useCompactViewport', () => ({ useCompactViewport: () => true }));

describe('B553: «Карта» на 390 — push-экран (макет 4 ?mv=map)', () => {
  it('шапка с «Назад», заголовком и консультантом; заметка под картой, без фильтров', () => {
    const html = renderToStaticMarkup(
      <VacancyMapView
        items={[]}
        onSelectCity={vi.fn()}
        onShowList={vi.fn()}
        onOpenExpert={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Назад"');
    expect(html).toContain('<h1 id="vacancy-map-push-title">Карта</h1>');
    expect(html).toContain('aria-label="Спросить консультанта"');
    expect(html).toContain('class="career-map-push-note"');
    expect(html).not.toContain('career-map-header');
  });

  it('заметка — одна строка, без кнопки «i»: в макете 4 на 390 её нет', () => {
    const html = renderToStaticMarkup(
      <VacancyMapView items={[]} onSelectCity={vi.fn()} onShowList={vi.fn()} />,
    );

    expect(html).toContain('На карте 0 из 0');
    expect(html).not.toContain('aria-label="Почему не все вакансии на карте"');
    expect(html).not.toContain('Управление масштабом карты');
    expect(html).not.toContain('Кластеры разбиваются');
  });
});
