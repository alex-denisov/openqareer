import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VacancyCityFilterBar, VacancyMapView } from './VacancyMapView';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';

function makeItem(
  id: string,
  company: string,
  city?: string,
  coords?: { lat: number; lng: number },
): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: `Frontend Engineer ${id}`,
      canonicalCompany: company,
      canonicalLocation: city ? `${city}, Страна` : undefined,
      isRemote: false,
      descriptionSummary: '',
      skills: ['React'],
      primaryUrl: `https://test.example/${id}`,
      sources: [
        {
          sourceType: 'json_api',
          sourceId: 'ats-test',
          sourceUrl: 'https://test.example',
          observedAt: '2026-09-01',
        },
      ],
      firstObservedAt: '2026-09-01T00:00:00.000Z',
      lastSeenAt: '2026-09-06T00:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
      companyFeatures: {
        city,
        coordinates: coords,
        relocation: true,
      },
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target',
      levelMatch: 'unknown',
      requirements: { matched: 1, total: 1 },
      matchingPoints: ['React'],
      missingPoints: [],
      summary: '1 из 1',
      calculatedAt: '2026-09-06T00:00:00.000Z',
    },
  };
}

describe('B203: VacancyMapView Component', () => {
  const items: MatchedVacancyItem[] = [
    makeItem('v1', 'Miro', 'Амстердам', { lat: 52.3676, lng: 4.9041 }),
    makeItem('v2', 'ASML', 'Велдховен', { lat: 51.4172, lng: 5.4055 }),
    makeItem('v3', 'UnknownLocationCo'),
  ];

  it('renders map header with honest denominators and missing-place counts', () => {
    const html = renderToStaticMarkup(
      <VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />,
    );

    // B485: заметка макета 4 — числа из выдачи и причина, почему у части нет точки.
    expect(html).toContain('На карте 2 из 3: без точки 1 без города.');
    expect(html.indexOf('career-map-canvas-container')).toBeLessThan(
      html.indexOf('career-map-header'),
    );
  });

  it('показывает без города и нераспознанные названия раздельно', () => {
    const html = renderToStaticMarkup(
      <VacancyMapView
        items={[
          makeItem('mapped', 'Miro', 'Amsterdam', { lat: 52.3676, lng: 4.9041 }),
          makeItem('missing', 'UnknownLocationCo'),
          makeItem('unresolved', 'UnknownCityCo', 'Unknown Vacancy City'),
        ]}
        onSelectCity={vi.fn()}
      />,
    );

    expect(html).toContain('На карте 1 из 3: без точки 1 без города, 1 с нераспознанным городом.');
  });

  it('подписывает город на карте как «Almaty 4», без ряда чипов и сетки карточек (B446-g4)', () => {
    const html = renderToStaticMarkup(
      <VacancyMapView
        items={[
          makeItem('v1', 'Miro', 'Almaty', { lat: 43.25249, lng: 76.9115 }),
          makeItem('v2', 'ASML', 'Almaty', { lat: 43.25249, lng: 76.9115 }),
          makeItem('v3', '10up', 'Almaty', { lat: 43.25249, lng: 76.9115 }),
          makeItem('v4', 'LocalCo', 'Almaty', { lat: 43.25249, lng: 76.9115 }),
        ]}
        onSelectCity={vi.fn()}
      />,
    );

    expect(html).toContain('<tspan class="career-map-label-count"> 4</tspan>');
    expect(html).not.toContain('career-map-city-chips');
    expect(html).not.toContain('career-map-cards-grid');
    expect(html).not.toContain('Frontend Engineer v1');
  });

  it('renders city pins and list with names and counts', () => {
    const html = renderToStaticMarkup(
      <VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />,
    );

    expect(html).toContain('Амстердам');
    expect(html).toContain('Велдховен');
  });

  it('рисует локальные контуры стран, а город выбирается доступной кнопкой', () => {
    const html = renderToStaticMarkup(
      <VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />,
    );
    const countryContours = html.match(/class="career-map-country"/gu) ?? [];

    expect(html).toContain('role="img" aria-label="Контуры стран и расположение городов"');
    expect(countryContours).toHaveLength(177);
    // B446-g4: ряда чипов нет — близкие города доступны кнопкой-кластером на карте.
    expect(html).toMatch(/role="button"[^>]*aria-label="Кластер/u);
  });

  it('city filter bar names the chosen city and offers all cities back', () => {
    const html = renderToStaticMarkup(
      <VacancyCityFilterBar selectedCity="Амстердам" onClear={vi.fn()} />,
    );

    expect(html).toContain('Показаны вакансии в городе: <strong>Амстердам</strong>');
    expect(html).toContain('Все города');
    expect(renderToStaticMarkup(<VacancyCityFilterBar onClear={vi.fn()} />)).toBe('');
  });
});
