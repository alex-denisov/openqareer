import fs from 'node:fs';
import path from 'node:path';
import {
  extractDomainFromUrl,
  normalizeCompanyName,
  type Company,
  type CompanyAttributeClaim,
} from './company';
import {
  ingestBuildinRuAbroad,
  ingestDriveCompanies,
  ingestNotionRelocation,
  ingestTelegraphCurrencyRemote,
  mergeCompanyRecords,
  type BuildinRuAbroadRaw,
  type DriveCompanyRaw,
  type IngestedCompanyRecord,
  type NotionRelocationRaw,
  type TelegraphCurrencyRemoteRaw,
} from './companyListIngestion';
import type { UnifiedVacancy } from './unifiedVacancy';

export interface CompanyQuery {
  readonly search?: string;
  readonly relocation?: boolean;
  readonly currencyRemote?: boolean;
  readonly russianAbroad?: boolean;
  readonly fullRemote?: boolean;
  readonly country?: string;
  readonly city?: string;
  readonly industry?: string;
  readonly hasAtsBoard?: boolean;
  readonly hasLiveVacancies?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CompanyRegistryStats {
  readonly totalCompanies: number;
  readonly withRelocation: number;
  readonly withCurrencyRemote: number;
  readonly withRussianAbroad: number;
  readonly withAtsBoards: number;
  readonly withCoordinates: number;
  readonly verifiedWithLiveVacancies: number;
}

const DEFAULT_EVIDENCE_DIR = path.resolve(
  process.cwd(),
  'docs/v1-release/tasks/evidence/B199-source-probe',
);

function matchesSearch(c: Company, search?: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase().trim();
  return (
    c.name.toLowerCase().includes(q) ||
    Boolean(c.industry?.toLowerCase().includes(q)) ||
    Boolean(c.domain?.toLowerCase().includes(q)) ||
    c.locations.some(
      (l) => l.city?.toLowerCase().includes(q) || l.country?.toLowerCase().includes(q),
    )
  );
}

function matchesAttributeFacets(c: Company, query: CompanyQuery): boolean {
  if (query.relocation !== undefined) {
    const hasReloc = c.attributes.some(
      (a) => a.key === 'relocation' && Boolean(a.value) === query.relocation,
    );
    if (!hasReloc) return false;
  }
  if (query.currencyRemote !== undefined) {
    const hasCurr = c.attributes.some(
      (a) => a.key === 'currency_remote' && Boolean(a.value) === query.currencyRemote,
    );
    if (!hasCurr) return false;
  }
  if (query.russianAbroad !== undefined) {
    const hasRu = c.attributes.some(
      (a) => a.key === 'russian_founded_abroad' && Boolean(a.value) === query.russianAbroad,
    );
    if (!hasRu) return false;
  }
  if (query.fullRemote !== undefined) {
    const hasRemote = c.attributes.some(
      (a) => a.key === 'full_remote' && Boolean(a.value) === query.fullRemote,
    );
    if (!hasRemote) return false;
  }
  return true;
}

function matchesLocationAndAts(c: Company, query: CompanyQuery): boolean {
  if (query.country) {
    const target = query.country.toLowerCase().trim();
    if (!c.locations.some((l) => l.country?.toLowerCase().includes(target))) {
      return false;
    }
  }
  if (query.city) {
    const target = query.city.toLowerCase().trim();
    if (!c.locations.some((l) => l.city?.toLowerCase().includes(target))) {
      return false;
    }
  }
  if (query.hasAtsBoard !== undefined && Boolean(c.atsProvider) !== query.hasAtsBoard) {
    return false;
  }
  if (
    query.hasLiveVacancies !== undefined &&
    (c.verifiedVacanciesCount > 0) !== query.hasLiveVacancies
  ) {
    return false;
  }
  return true;
}

export class CompanyRegistry {
  private companies: Map<string, Company> = new Map();
  private domainIndex: Map<string, string> = new Map();
  private nameIndex: Map<string, string> = new Map();

  constructor() {}

  /**
   * Loads the 4 verified owner lists from evidence directory and indexes all companies.
   */
  public loadOwnerLists(baseDir = DEFAULT_EVIDENCE_DIR): void {
    const records: IngestedCompanyRecord[] = [];

    const notionPath = path.join(baseDir, 'notion-160-relocation.json');
    if (fs.existsSync(notionPath)) {
      const data = JSON.parse(fs.readFileSync(notionPath, 'utf-8')) as NotionRelocationRaw[];
      records.push(...ingestNotionRelocation(data));
    }

    const telegraphPath = path.join(baseDir, 'telegraph-240-currency-remote.json');
    if (fs.existsSync(telegraphPath)) {
      const data = JSON.parse(fs.readFileSync(telegraphPath, 'utf-8')) as TelegraphCurrencyRemoteRaw[];
      records.push(...ingestTelegraphCurrencyRemote(data));
    }

    const buildinPath = path.join(baseDir, 'buildin-ru-abroad.json');
    if (fs.existsSync(buildinPath)) {
      const data = JSON.parse(fs.readFileSync(buildinPath, 'utf-8')) as BuildinRuAbroadRaw[];
      records.push(...ingestBuildinRuAbroad(data));
    }

    const drivePath = path.join(baseDir, 'drive-companies.json');
    if (fs.existsSync(drivePath)) {
      const data = JSON.parse(fs.readFileSync(drivePath, 'utf-8')) as DriveCompanyRaw[];
      records.push(...ingestDriveCompanies(data));
    }

    const merged = mergeCompanyRecords(records);
    this.companies.clear();
    this.domainIndex.clear();
    this.nameIndex.clear();

    for (const comp of merged) {
      this.companies.set(comp.id, comp);
      this.nameIndex.set(comp.canonicalName, comp.id);
      if (comp.domain) {
        this.domainIndex.set(comp.domain, comp.id);
      }
    }
  }

  public getAll(): readonly Company[] {
    return Array.from(this.companies.values());
  }

  public getById(id: string): Company | undefined {
    return this.companies.get(id);
  }

  public findByName(name: string): Company | undefined {
    const canonical = normalizeCompanyName(name);
    const id = this.nameIndex.get(canonical);
    return id ? this.companies.get(id) : undefined;
  }

  public findByDomain(domain: string): Company | undefined {
    const clean = domain.toLowerCase().trim();
    const id = this.domainIndex.get(clean);
    return id ? this.companies.get(id) : undefined;
  }

  /**
   * Links live vacancy to company in registry and updates claim verifications.
   */
  public linkLiveVacancy(vacancy: UnifiedVacancy): boolean {
    let company: Company | undefined;

    if (vacancy.url) {
      const domain = extractDomainFromUrl(vacancy.url);
      if (domain) {
        company = this.findByDomain(domain);
      }
    }

    if (!company && vacancy.company) {
      company = this.findByName(vacancy.company);
    }

    if (!company) {
      return false;
    }

    const now = new Date().toISOString();
    const vacText = `${vacancy.title} ${vacancy.description ?? ''} ${vacancy.location ?? ''}`.toLowerCase();
    const mentionsReloc = vacText.includes('reloc') || vacText.includes('релок') || vacText.includes('visa');

    const updatedAttributes: CompanyAttributeClaim[] = company.attributes.map((attr) => {
      if (attr.key === 'relocation' && mentionsReloc) {
        return {
          ...attr,
          status: 'verified_by_live_vacancy',
          verifiedAt: now,
          verifiedVacancyId: vacancy.id,
        };
      }
      return attr;
    });

    const updatedCompany: Company = {
      ...company,
      attributes: updatedAttributes,
      verifiedVacanciesCount: company.verifiedVacanciesCount + 1,
      updatedAt: now,
    };

    this.companies.set(company.id, updatedCompany);
    return true;
  }

  /**
   * Query and filter companies by facets and criteria.
   */
  public filter(query: CompanyQuery): Company[] {
    let result = Array.from(this.companies.values()).filter(
      (c) =>
        matchesSearch(c, query.search) &&
        matchesAttributeFacets(c, query) &&
        matchesLocationAndAts(c, query),
    );

    if (query.offset !== undefined) {
      result = result.slice(query.offset);
    }
    if (query.limit !== undefined) {
      result = result.slice(0, query.limit);
    }
    return result;
  }

  public getStats(): CompanyRegistryStats {
    let withRelocation = 0;
    let withCurrencyRemote = 0;
    let withRussianAbroad = 0;
    let withAtsBoards = 0;
    let withCoordinates = 0;
    let verifiedWithLiveVacancies = 0;

    for (const c of this.companies.values()) {
      if (c.attributes.some((a) => a.key === 'relocation')) withRelocation++;
      if (c.attributes.some((a) => a.key === 'currency_remote')) withCurrencyRemote++;
      if (c.attributes.some((a) => a.key === 'russian_founded_abroad')) withRussianAbroad++;
      if (c.atsProvider) withAtsBoards++;
      if (c.locations.some((l) => l.coordinates !== undefined)) withCoordinates++;
      if (c.verifiedVacanciesCount > 0) verifiedWithLiveVacancies++;
    }

    return {
      totalCompanies: this.companies.size,
      withRelocation,
      withCurrencyRemote,
      withRussianAbroad,
      withAtsBoards,
      withCoordinates,
      verifiedWithLiveVacancies,
    };
  }
}

let singletonRegistry: CompanyRegistry | null = null;

export function getCompanyRegistry(): CompanyRegistry {
  if (!singletonRegistry) {
    singletonRegistry = new CompanyRegistry();
    singletonRegistry.loadOwnerLists();
  }
  return singletonRegistry;
}
