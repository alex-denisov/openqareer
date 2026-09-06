export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

const CITY_COORDINATES: Readonly<Record<string, GeoPoint>> = {
  // Netherlands
  amsterdam: { lat: 52.3676, lng: 4.9041 },
  амстердам: { lat: 52.3676, lng: 4.9041 },
  eindhoven: { lat: 51.4416, lng: 5.4697 },
  эйндховен: { lat: 51.4416, lng: 5.4697 },
  veldhoven: { lat: 51.4178, lng: 5.4054 },
  велдховен: { lat: 51.4178, lng: 5.4054 },
  utrecht: { lat: 52.0907, lng: 5.1214 },
  утрехт: { lat: 52.0907, lng: 5.1214 },
  rotterdam: { lat: 51.9244, lng: 4.4777 },
  роттердам: { lat: 51.9244, lng: 4.4777 },
  nijmegen: { lat: 51.8426, lng: 5.8596 },
  неймеген: { lat: 51.8426, lng: 5.8596 },
  thehague: { lat: 52.0705, lng: 4.3007 },
  гаага: { lat: 52.0705, lng: 4.3007 },

  // Germany
  berlin: { lat: 52.52, lng: 13.405 },
  берлин: { lat: 52.52, lng: 13.405 },
  munich: { lat: 48.1351, lng: 11.582 },
  мюнхен: { lat: 48.1351, lng: 11.582 },
  frankfurt: { lat: 50.1109, lng: 8.6821 },
  франкфурт: { lat: 50.1109, lng: 8.6821 },
  hamburg: { lat: 53.5511, lng: 9.9937 },
  гамбург: { lat: 53.5511, lng: 9.9937 },
  cologne: { lat: 50.9375, lng: 6.9603 },
  кёльн: { lat: 50.9375, lng: 6.9603 },
  dusseldorf: { lat: 51.2277, lng: 6.7735 },
  дюссельдорф: { lat: 51.2277, lng: 6.7735 },

  // UK
  london: { lat: 51.5074, lng: -0.1278 },
  лондон: { lat: 51.5074, lng: -0.1278 },
  manchester: { lat: 53.4808, lng: -2.2426 },
  манчестер: { lat: 53.4808, lng: -2.2426 },
  cambridge: { lat: 52.2053, lng: 0.1218 },
  кембридж: { lat: 52.2053, lng: 0.1218 },
  edinburgh: { lat: 55.9533, lng: -3.1883 },
  эдинбург: { lat: 55.9533, lng: -3.1883 },

  // Armenia, Georgia, Serbia, Cyprus
  yerevan: { lat: 40.1792, lng: 44.4991 },
  ереван: { lat: 40.1792, lng: 44.4991 },
  tbilisi: { lat: 41.7151, lng: 44.8271 },
  тбилиси: { lat: 41.7151, lng: 44.8271 },
  belgrade: { lat: 44.7866, lng: 20.4489 },
  белград: { lat: 44.7866, lng: 20.4489 },
  novisad: { lat: 45.2671, lng: 19.8335 },
  новисад: { lat: 45.2671, lng: 19.8335 },
  limassol: { lat: 34.7071, lng: 33.0226 },
  лимасол: { lat: 34.7071, lng: 33.0226 },
  лимассол: { lat: 34.7071, lng: 33.0226 },
  nicosia: { lat: 35.1856, lng: 33.3823 },
  никосия: { lat: 35.1856, lng: 33.3823 },

  // UAE, Kazakhstan
  dubai: { lat: 25.2048, lng: 55.2708 },
  дубай: { lat: 25.2048, lng: 55.2708 },
  abudhabi: { lat: 24.4539, lng: 54.3773 },
  абудаби: { lat: 24.4539, lng: 54.3773 },
  almaty: { lat: 43.222, lng: 76.8512 },
  алматы: { lat: 43.222, lng: 76.8512 },
  astana: { lat: 51.1694, lng: 71.4491 },
  астана: { lat: 51.1694, lng: 71.4491 },

  // Poland, Portugal, Spain, France
  warsaw: { lat: 52.2297, lng: 21.0122 },
  варшава: { lat: 52.2297, lng: 21.0122 },
  krakow: { lat: 50.0647, lng: 19.945 },
  краков: { lat: 50.0647, lng: 19.945 },
  lisbon: { lat: 38.7223, lng: -9.1393 },
  лиссабон: { lat: 38.7223, lng: -9.1393 },
  porto: { lat: 41.1579, lng: -8.6291 },
  порту: { lat: 41.1579, lng: -8.6291 },
  barcelona: { lat: 41.3851, lng: 2.1734 },
  барселона: { lat: 41.3851, lng: 2.1734 },
  madrid: { lat: 40.4168, lng: -3.7038 },
  мадрид: { lat: 40.4168, lng: -3.7038 },
  paris: { lat: 48.8566, lng: 2.3522 },
  париж: { lat: 48.8566, lng: 2.3522 },

  // US & Others
  newyork: { lat: 40.7128, lng: -74.006 },
  ньюйорк: { lat: 40.7128, lng: -74.006 },
  sanfrancisco: { lat: 37.7749, lng: -122.4194 },
  санфранциско: { lat: 37.7749, lng: -122.4194 },
  dublin: { lat: 53.3498, lng: -6.2603 },
  дублин: { lat: 53.3498, lng: -6.2603 },
  singapore: { lat: 1.3521, lng: 103.8198 },
  сингапур: { lat: 1.3521, lng: 103.8198 },
};

const COUNTRY_COORDINATES: Readonly<Record<string, GeoPoint>> = {
  нидерланды: { lat: 52.1326, lng: 5.2913 },
  netherlands: { lat: 52.1326, lng: 5.2913 },
  германия: { lat: 51.1657, lng: 10.4515 },
  germany: { lat: 51.1657, lng: 10.4515 },
  великобритания: { lat: 55.3781, lng: -3.436 },
  uk: { lat: 55.3781, lng: -3.436 },
  армения: { lat: 40.0691, lng: 45.0382 },
  armenia: { lat: 40.0691, lng: 45.0382 },
  сербия: { lat: 44.0165, lng: 21.0059 },
  serbia: { lat: 44.0165, lng: 21.0059 },
  кипр: { lat: 35.1264, lng: 33.4299 },
  cyprus: { lat: 35.1264, lng: 33.4299 },
  грузия: { lat: 42.3154, lng: 43.3569 },
  georgia: { lat: 42.3154, lng: 43.3569 },
  оаэ: { lat: 23.4241, lng: 53.8478 },
  uae: { lat: 23.4241, lng: 53.8478 },
  сша: { lat: 37.0902, lng: -95.7129 },
  usa: { lat: 37.0902, lng: -95.7129 },
  казахстан: { lat: 48.0196, lng: 66.9237 },
  kazakhstan: { lat: 48.0196, lng: 66.9237 },
  польша: { lat: 51.9194, lng: 19.1451 },
  poland: { lat: 51.9194, lng: 19.1451 },
  португалия: { lat: 39.3999, lng: -8.2245 },
  portugal: { lat: 39.3999, lng: -8.2245 },
  испания: { lat: 40.4637, lng: -3.7492 },
  spain: { lat: 40.4637, lng: -3.7492 },
  франция: { lat: 46.2276, lng: 2.2137 },
  france: { lat: 46.2276, lng: 2.2137 },
};

function normalizeGeoKey(text?: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

/**
 * Returns geographic coordinates for a city or country, or undefined if unknown.
 * Does not hallucinate coordinates for unrecognised locations.
 */
export function lookupLocationCoordinates(
  city?: string,
  country?: string,
): GeoPoint | undefined {
  if (city) {
    const cityKey = normalizeGeoKey(city);
    if (cityKey && CITY_COORDINATES[cityKey]) {
      return CITY_COORDINATES[cityKey];
    }
  }

  if (country) {
    const countryKey = normalizeGeoKey(country);
    if (countryKey && COUNTRY_COORDINATES[countryKey]) {
      return COUNTRY_COORDINATES[countryKey];
    }
  }

  return undefined;
}
