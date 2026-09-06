import { describe, expect, it } from "vitest";
import type { MatchedVacancyItem } from "../coach/cabinetTypes";
import {
  calculateVacancyFacets,
  filterVacanciesByFacets,
  formatFacetDenominator,
} from "./vacancyFacets";

function makeItem(
  id: string,
  company: string,
  overrides: {
    isRemote?: boolean;
    location?: string;
    features?: {
      relocation?: boolean;
      currencyRemote?: boolean;
      russianAbroad?: boolean;
      fullRemote?: boolean;
      industry?: string;
      city?: string;
      country?: string;
      coordinates?: { lat: number; lng: number };
    };
  } = {},
): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: `Title ${id}`,
      canonicalCompany: company,
      canonicalLocation: overrides.location ?? "Москва",
      isRemote: Boolean(overrides.isRemote),
      descriptionSummary: "",
      skills: [],
      primaryUrl: `https://test.example/${id}`,
      sources: [],
      firstObservedAt: "2026-09-01T00:00:00.000Z",
      lastSeenAt: "2026-09-06T00:00:00.000Z",
      status: "active",
      vacanciesCount: 1,
      companyFeatures: overrides.features,
    },
    explanation: {
      clusterId: id,
      roleMatch: "target",
      requirements: { matched: 2, total: 3 },
      matchingPoints: ["Skill A"],
      missingPoints: ["Skill B"],
      summary: "2 из 3",
      calculatedAt: "2026-09-06T00:00:00.000Z",
    },
  };
}

describe("B203: Vacancy Facets and Map/Feature Projections", () => {
  const sampleItems: MatchedVacancyItem[] = [
    makeItem("vac-1", "ASML", {
      location: "Велдховен, Нидерланды",
      features: {
        relocation: true,
        industry: "Semiconductors",
        city: "Велдховен",
        country: "Нидерланды",
        coordinates: { lat: 51.4172, lng: 5.4055 },
      },
    }),
    makeItem("vac-2", "Miro", {
      location: "Амстердам, Нидерланды",
      isRemote: true,
      features: {
        relocation: true,
        currencyRemote: true,
        russianAbroad: true,
        fullRemote: true,
        industry: "SaaS / Collaboration",
        city: "Амстердам",
        country: "Нидерланды",
        coordinates: { lat: 52.3676, lng: 4.9041 },
      },
    }),
    makeItem("vac-3", "10up", {
      isRemote: true,
      features: {
        currencyRemote: true,
        fullRemote: true,
        industry: "Digital Agency",
      },
    }),
    makeItem("vac-4", "LocalCo", {
      location: "Москва",
      features: {
        industry: "Retail",
      },
    }),
  ];

  describe("calculateVacancyFacets (rule B192: honest denominators)", () => {
    it("computes accurate counts and denominators for all feature slices", () => {
      const facets = calculateVacancyFacets(sampleItems);

      expect(facets.total).toBe(4);
      expect(facets.relocation).toEqual({ count: 2, total: 4 });
      expect(facets.currencyRemote).toEqual({ count: 2, total: 4 });
      expect(facets.russianAbroad).toEqual({ count: 1, total: 4 });
      expect(facets.fullRemote).toEqual({ count: 2, total: 4 });
      expect(facets.onMap).toEqual({ count: 2, total: 4, unmappedCount: 2 });

      expect(facets.industries).toHaveLength(4);
      expect(facets.industries[0].count).toBe(1);

      expect(facets.cities).toHaveLength(2);
      const ams = facets.cities.find((c) => c.city === "Амстердам");
      expect(ams).toBeDefined();
      expect(ams?.coordinates).toEqual({ lat: 52.3676, lng: 4.9041 });
      expect(ams?.count).toBe(1);
    });

    it("handles empty pool gracefully with honest zeroes", () => {
      const facets = calculateVacancyFacets([]);
      expect(facets.total).toBe(0);
      expect(facets.relocation).toEqual({ count: 0, total: 0 });
      expect(facets.onMap).toEqual({ count: 0, total: 0, unmappedCount: 0 });
      expect(facets.industries).toEqual([]);
      expect(facets.cities).toEqual([]);
    });

    it("formats honest denominator label according to B192", () => {
      expect(formatFacetDenominator("Релокация", { count: 2, total: 4 })).toBe("Релокация (2 из 4)");
      expect(formatFacetDenominator("Удалённо", { count: 0, total: 0 })).toBe("Удалённо (0 из 0)");
    });
  });

  describe("filterVacanciesByFacets", () => {
    it("filters by relocation packages", () => {
      const filtered = filterVacanciesByFacets(sampleItems, { relocationOnly: true });
      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.cluster.canonicalCompany)).toEqual(["ASML", "Miro"]);
    });

    it("filters by currency remote", () => {
      const filtered = filterVacanciesByFacets(sampleItems, { currencyRemoteOnly: true });
      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.cluster.canonicalCompany)).toEqual(["Miro", "10up"]);
    });

    it("filters by russian founded companies abroad", () => {
      const filtered = filterVacanciesByFacets(sampleItems, { russianAbroadOnly: true });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].cluster.canonicalCompany).toBe("Miro");
    });

    it("filters by full remote", () => {
      const filtered = filterVacanciesByFacets(sampleItems, { fullRemoteOnly: true });
      expect(filtered).toHaveLength(2);
    });

    it("filters by industry/domain", () => {
      const filtered = filterVacanciesByFacets(sampleItems, { industry: "Semiconductors" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].cluster.canonicalCompany).toBe("ASML");
    });

    it("filters by city", () => {
      const filtered = filterVacanciesByFacets(sampleItems, { city: "Амстердам" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].cluster.canonicalCompany).toBe("Miro");
    });

    it("filters by onMapOnly (requires recognized coordinates)", () => {
      const filtered = filterVacanciesByFacets(sampleItems, { onMapOnly: true });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((f) => f.cluster.companyFeatures?.coordinates !== undefined)).toBe(true);
    });

    it("combines multiple facets with boolean AND", () => {
      const filtered = filterVacanciesByFacets(sampleItems, {
        relocationOnly: true,
        currencyRemoteOnly: true,
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].cluster.canonicalCompany).toBe("Miro");
    });
  });
});

describe("город на карте считается один раз", () => {
  it("сводит «US - San Francisco» и «San Francisco» в один хаб", () => {
    const items = [
      makeItem("c-1", "Alpha", {
        location: "San Francisco, United States",
        features: { city: "San Francisco", coordinates: { lat: 37.7749, lng: -122.4194 } },
      }),
      makeItem("c-2", "Beta", {
        location: "US - San Francisco, United States",
        features: { city: "US - San Francisco", coordinates: { lat: 37.7749, lng: -122.4194 } },
      }),
    ];

    const cities = calculateVacancyFacets(items).cities;
    const sf = cities.filter((c) => c.city.toLowerCase().includes("san francisco"));
    expect(sf).toHaveLength(1);
    expect(sf[0]?.count).toBe(2);
  });

  it("перечисление стран на карту не попадает", () => {
    const items = [
      makeItem("c-3", "Gamma", {
        location: "Germany (Remote) ; Ireland (Remote) ; Portugal (Remote)",
        features: {
          city: "Germany (Remote) ; Ireland (Remote) ; Portugal (Remote)",
          coordinates: { lat: 51.1657, lng: 10.4515 },
        },
      }),
    ];

    expect(calculateVacancyFacets(items).cities).toHaveLength(0);
  });
});

describe("страна и способ работы в списке городов не появляются", () => {
  it("«USA» и «EMEA» городами-хабами не становятся", () => {
    const items = [
      makeItem("c-10", "Delta", { location: "USA", features: { city: "USA" } }),
      makeItem("c-11", "Epsilon", { location: "EMEA", features: { city: "EMEA" } }),
      makeItem("c-12", "Zeta", {
        location: "Berlin, Germany",
        features: { city: "Berlin", coordinates: { lat: 52.52, lng: 13.405 } },
      }),
    ];

    const cities = calculateVacancyFacets(items).cities.map((c) => c.city);
    expect(cities).toEqual(["Berlin"]);
  });
});
