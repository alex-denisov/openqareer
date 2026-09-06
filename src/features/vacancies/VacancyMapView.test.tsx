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

  it("renders map header with honest counts and denominators", () => {
    const html = renderToStaticMarkup(<VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />);

    expect(html).toContain("<strong>2</strong> на карте");
    expect(html).toContain("<strong>1</strong> без точных координат");
    expect(html).toContain("города-хаба");
  });

  it("renders city pins and list with names and counts", () => {
    const html = renderToStaticMarkup(<VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />);

    expect(html).toContain("Амстердам");
    expect(html).toContain("Велдховен");
  });

  it("highlights selected city when passed", () => {
    const html = renderToStaticMarkup(<VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity="Амстердам" />);

    expect(html).toContain("Показаны вакансии в городе: <strong>Амстердам</strong>");
    expect(html).toContain("Все города на карте");
  });

  it("renders unmapped vacancies section honestly", () => {
    const html = renderToStaticMarkup(<VacancyMapView items={items} onSelectCity={vi.fn()} selectedCity={undefined} />);

    expect(html).toContain("Без точных координат");
    expect(html).toContain("UnknownLocationCo");
  });
});
