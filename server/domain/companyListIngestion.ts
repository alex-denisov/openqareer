import {
  extractDomainFromUrl,
  normalizeCompanyName,
  type Company,
  type CompanyAttributeClaim,
  type CompanyLocation,
} from './company';
import { lookupLocationCoordinates } from './geoCoordinates';
import { MEASURED_ATS_BOARDS } from '../vacancies/atsBoardMeasurements';

export interface NotionRelocationRaw {
  readonly company: string;
  readonly region?: string;
  readonly locations?: string;
  readonly industry?: string;
  readonly tier?: string;
  readonly note?: string;
  readonly source: string;
  readonly readAt: string;
}

export interface TelegraphCurrencyRemoteRaw {
  readonly company: string;
  readonly attribute?: string;
  readonly source: string;
  readonly readAt: string;
  readonly route?: string;
}

export interface BuildinRuAbroadRaw {
  readonly company: string;
  readonly source: string;
  readonly readAt: string;
  readonly careersUrl?: string;
  readonly countries?: string;
  readonly industry?: string;
  readonly linkedinUrl?: string;
}

export interface DriveCompanyRaw {
  readonly company: string;
  readonly careersUrl?: string;
  readonly sector?: string;
  readonly source: string;
  readonly readAt: string;
}

export interface IngestedCompanyRecord {
  readonly name: string;
  readonly canonicalName: string;
  readonly domain?: string;
  readonly careersUrl?: string;
  readonly linkedinUrl?: string;
  readonly industry?: string;
  readonly locations: readonly CompanyLocation[];
  readonly attributes: readonly CompanyAttributeClaim[];
}

function cleanEmoji(text: string): string {
  return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
}

function parseNotionLocations(
  locationsStr?: string,
  region?: string,
): CompanyLocation[] {
  const result: CompanyLocation[] = [];
  const cleanRegion = region ? cleanEmoji(region) : undefined;

  if (locationsStr) {
    const parts = locationsStr.split(',').map((s) => s.trim()).filter(Boolean);
    for (const city of parts) {
      const cleanCity = cleanEmoji(city);
      const coords = lookupLocationCoordinates(cleanCity, cleanRegion);
      result.push({
        city: cleanCity,
        country: cleanRegion,
        coordinates: coords,
      });
    }
  } else if (cleanRegion) {
    const coords = lookupLocationCoordinates(undefined, cleanRegion);
    result.push({
      country: cleanRegion,
      coordinates: coords,
    });
  }

  return result;
}

export function ingestNotionRelocation(
  items: readonly NotionRelocationRaw[],
): IngestedCompanyRecord[] {
  return items.map((item) => {
    const canonicalName = normalizeCompanyName(item.company);
    const locations = parseNotionLocations(item.locations, item.region);
    const claim: CompanyAttributeClaim = {
      key: 'relocation',
      value: true,
      status: 'claimed_by_source',
      provenance: {
        source: item.source,
        sourceLabel: 'Notion 160 компаний, которые релоцируют',
        readAt: item.readAt,
        rawNote: item.note,
        tier: item.tier,
      },
    };

    return {
      name: item.company.trim(),
      canonicalName,
      industry: item.industry?.trim(),
      locations,
      attributes: [claim],
    };
  });
}

export function ingestTelegraphCurrencyRemote(
  items: readonly TelegraphCurrencyRemoteRaw[],
): IngestedCompanyRecord[] {
  return items.map((item) => {
    const canonicalName = normalizeCompanyName(item.company);
    const claim: CompanyAttributeClaim = {
      key: 'currency_remote',
      value: true,
      status: 'claimed_by_source',
      provenance: {
        source: item.source,
        sourceLabel: 'Telegra.ph 240 компаний для валютных удалёнок',
        readAt: item.readAt,
        route: item.route,
      },
    };

    return {
      name: item.company.trim(),
      canonicalName,
      locations: [],
      attributes: [claim],
    };
  });
}

function parseBuildinCountries(countriesStr?: string): CompanyLocation[] {
  if (!countriesStr) return [];
  const list = countriesStr.split(',').map((s) => cleanEmoji(s.trim())).filter(Boolean);
  return list.map((country) => ({
    country,
    coordinates: lookupLocationCoordinates(undefined, country),
  }));
}

export function ingestBuildinRuAbroad(
  items: readonly BuildinRuAbroadRaw[],
): IngestedCompanyRecord[] {
  return items.map((item) => {
    const canonicalName = normalizeCompanyName(item.company);
    const domain = extractDomainFromUrl(item.careersUrl);
    const locations = parseBuildinCountries(item.countries);

    const claims: CompanyAttributeClaim[] = [
      {
        key: 'russian_founded_abroad',
        value: true,
        status: 'claimed_by_source',
        provenance: {
          source: item.source,
          sourceLabel: 'Buildin.ai русскоязычные компании на международке',
          readAt: item.readAt,
        },
      },
    ];

    if (item.countries?.toLowerCase().includes('remote')) {
      claims.push({
        key: 'full_remote',
        value: true,
        status: 'claimed_by_source',
        provenance: {
          source: item.source,
          sourceLabel: 'Buildin.ai русскоязычные компании на международке',
          readAt: item.readAt,
          rawNote: 'Указан статус Remote',
        },
      });
    }

    return {
      name: item.company.trim(),
      canonicalName,
      domain,
      careersUrl: item.careersUrl?.trim(),
      linkedinUrl: item.linkedinUrl?.trim(),
      industry: item.industry?.trim(),
      locations,
      attributes: claims,
    };
  });
}

export function ingestDriveCompanies(
  items: readonly DriveCompanyRaw[],
): IngestedCompanyRecord[] {
  return items.map((item) => {
    const canonicalName = normalizeCompanyName(item.company);
    const domain = extractDomainFromUrl(item.careersUrl);
    const claims: CompanyAttributeClaim[] = [];

    if (item.sector) {
      claims.push({
        key: 'domain_tag',
        value: item.sector.trim(),
        status: 'claimed_by_source',
        provenance: {
          source: item.source,
          sourceLabel: 'Google Drive подборка 200+ ресурсов и компаний',
          readAt: item.readAt,
        },
      });
    }

    return {
      name: item.company.trim(),
      canonicalName,
      domain,
      careersUrl: item.careersUrl ? `https://${item.careersUrl.replace(/^https?:\/\//, '')}` : undefined,
      industry: item.sector?.trim(),
      locations: [],
      attributes: claims,
    };
  });
}

function combineClaims(
  existing: readonly CompanyAttributeClaim[],
  incoming: readonly CompanyAttributeClaim[],
): CompanyAttributeClaim[] {
  const merged = [...existing];
  for (const claim of incoming) {
    const exists = merged.some(
      (c) => c.key === claim.key && c.provenance.source === claim.provenance.source,
    );
    if (!exists) {
      merged.push(claim);
    }
  }
  return merged;
}

function combineLocations(
  existing: readonly CompanyLocation[],
  incoming: readonly CompanyLocation[],
): CompanyLocation[] {
  const merged = [...existing];
  for (const loc of incoming) {
    const exists = merged.some(
      (l) => l.city === loc.city && l.country === loc.country,
    );
    if (!exists) {
      merged.push(loc);
    }
  }
  return merged;
}

function mergeSingleRecord(
  existing: IngestedCompanyRecord,
  record: IngestedCompanyRecord,
  key: string,
): IngestedCompanyRecord {
  return {
    name: existing.name.length >= record.name.length ? existing.name : record.name,
    canonicalName: key,
    domain: existing.domain ?? record.domain,
    careersUrl: existing.careersUrl ?? record.careersUrl,
    linkedinUrl: existing.linkedinUrl ?? record.linkedinUrl,
    industry: existing.industry ?? record.industry,
    locations: combineLocations(existing.locations, record.locations),
    attributes: combineClaims(existing.attributes, record.attributes),
  };
}

function buildAtsLookup(): Map<string, { provider: string; board: string }> {
  const map = new Map<string, { provider: string; board: string }>();
  for (const b of MEASURED_ATS_BOARDS) {
    map.set(normalizeCompanyName(b.company), {
      provider: b.provider,
      board: b.board,
    });
  }
  return map;
}

/**
 * Merge ingested company records by canonical name or domain into unified Company entities.
 */
export function mergeCompanyRecords(
  records: readonly IngestedCompanyRecord[],
): Company[] {
  const map = new Map<string, IngestedCompanyRecord>();
  const domainToKey = new Map<string, string>();

  for (const record of records) {
    const domainKey = record.domain ? domainToKey.get(record.domain) : undefined;
    const key = domainKey ?? record.canonicalName;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, record);
    } else {
      map.set(key, mergeSingleRecord(existing, record, key));
    }
    if (record.domain) {
      domainToKey.set(record.domain, key);
    }
  }

  const atsLookup = buildAtsLookup();
  const now = new Date().toISOString();

  return Array.from(map.values()).map((record) => {
    const ats = atsLookup.get(record.canonicalName);
    return {
      id: `comp-${record.canonicalName}`,
      name: record.name,
      canonicalName: record.canonicalName,
      domain: record.domain,
      careersUrl: record.careersUrl,
      linkedinUrl: record.linkedinUrl,
      industry: record.industry,
      locations: record.locations,
      atsProvider: ats?.provider,
      atsBoardToken: ats?.board,
      attributes: record.attributes,
      verifiedVacanciesCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  });
}
