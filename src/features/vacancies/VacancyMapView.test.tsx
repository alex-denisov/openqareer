import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VacancyMapView } from "./VacancyMapView";
import type { MatchedVacancyItem } from "../coach/cabinetTypes";

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
      descriptionSummary: "",
      skills: ["React"],
      primaryUrl: `https://test.example/${id}`,
      sources: [{ sourceType: "json_api", sourceId: "ats-test", sourceUrl: "https://test.example", observedAt: "2026-09-01" }],
      firstObservedAt: "2026-09-01T00:00:00.000Z",
      lastSeenAt: "2026-09-06T00:00:00.000Z",
      status: "active",
      vacanciesCount: 1,
      companyFeatures: {
        city,
        coordinates: coords,
        relocation: true,
      },
    },
    explanation: {
      clusterId: id,
      roleMatch: "target",
      levelMatch: "unknown",
      requirements: { matched: 1, total: 1 },
      matchingPoints: ["React"],
      missingPoints: [],
      summary: "1 из 1",
      calculatedAt: "2026-09-06T00:00:00.000Z",
    },
  };
}

describe("B203: VacancyMapView Component", () => {
  const items: MatchedVacancyItem[] = [
    makeItem("v1", "Miro", "Амстердам", { lat: 52.3676, lng: 4.9041 }),
    makeItem("v2", "ASML", "Велдховен", { lat: 51.4172, lng: 5.4055 }),
    makeItem("v3", "UnknownLocationCo"),
  ];

  it("renders map header with honest denominators and missing-place counts", () => {
    const html = renderToStaticMarkup(<VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />);

    expect(html).toContain("На карте <strong>2</strong> из <strong>3</strong>");
    expect(html).toContain("без города: <strong>1</strong>");
    expect(html).toContain("город не распознан: <strong>0</strong>");
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

    expect(html).toContain('На карте <strong>1</strong> из <strong>3</strong>');
    expect(html).toContain('без города: <strong>1</strong>');
    expect(html).toContain('город не распознан: <strong>1</strong>');
  });

  it('разделяет город и моноширинный счётчик в списке и на карте', () => {
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

    expect(html).toContain('<span>Almaty</span>');
    expect(html).toContain(
      '<span class="career-map-city-count"><span aria-hidden="true">·</span><span class="career-map-city-count-value">4</span></span>',
    );
    expect(html).toContain('<tspan class="career-map-label-count"> · 4</tspan>');
  });

  it('при выборе города оставляет в списке все его координатные варианты', () => {
    const html = renderToStaticMarkup(
      <VacancyMapView
        items={[
          makeItem('ru', 'Russian Company', 'Москва', { lat: 55.75204, lng: 37.61781 }),
          makeItem('en', 'English Company', 'Moscow', { lat: 55.75204, lng: 37.61781 }),
        ]}
        selectedCity="Москва"
        onSelectCity={vi.fn()}
      />,
    );

    expect(html).toContain('Frontend Engineer ru');
    expect(html).toContain('Frontend Engineer en');
  });


  it("renders city pins and list with names and counts", () => {
    const html = renderToStaticMarkup(<VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />);

    expect(html).toContain("Амстердам");
    expect(html).toContain("Велдховен");
  });

  it('рисует локальные контуры стран, а город выбирается доступной кнопкой', () => {
    const html = renderToStaticMarkup(
      <VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />,
    );
    const countryContours = html.match(/class="career-map-country"/gu) ?? [];

    expect(html).toContain('role="img" aria-label="Контуры стран и расположение городов"');
    expect(countryContours).toHaveLength(177);
    expect(html).toContain('aria-label="Город Амстердам: 1 вакансий"');
    expect(html).not.toContain('role="button" aria-label="Город Амстердам: 1 вакансий"');
  });

  it("highlights selected city when passed", () => {
    const html = renderToStaticMarkup(<VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity="Амстердам" />);

    expect(html).toContain("Показаны вакансии в городе: <strong>Амстердам</strong>");
    expect(html).toContain("Все города на карте");
  });

  it("renders unmapped vacancies section honestly", () => {
    const html = renderToStaticMarkup(<VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />);

    expect(html).toContain("Не показаны на карте");
    expect(html).toContain("UnknownLocationCo");
  });
});

describe("кластеризация и подписи на карте (B375)", () => {
  it("близкие хабы объединяются в кластер с числом вакансий и списком в подсказке", () => {
    const html = renderToStaticMarkup(
      <VacancyMapView
        items={[
          makeItem("v-1", "Alpha", "Amsterdam", { lat: 52.37, lng: 4.9 }),
          makeItem("v-2", "Alpha", "Amsterdam", { lat: 52.37, lng: 4.9 }),
          makeItem("v-3", "Beta", "Haarlem", { lat: 52.38, lng: 4.63 }),
        ]}
        selectedCity={undefined}
        onSelectCity={() => {}}
      />,
    );

    expect(html).toContain('career-map-cluster-count');
    expect(html).toContain('>3</text>');
    expect(html).toContain('Кластер: 3 вакансий');
    expect(html).toContain("Город Haarlem: 1 вакансий");
  });

  it("показывает Сидней без AU: и страну во всплывающей подсказке", () => {
    const html = renderToStaticMarkup(
      <VacancyMapView
        items={[
          makeItem("v-au", "Atlassian", "AU: Sydney", { lat: -33.8688, lng: 151.2093 }),
        ]}
        selectedCity={undefined}
        onSelectCity={() => {}}
      />,
    );

    expect(html).toContain("Сидней");
    expect(html).not.toContain("AU: Sydney");
    expect(html).toContain("Австралия");
  });
});
