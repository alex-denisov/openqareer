import { describe, expect, it } from 'vitest';
import {
  extractDomainFromUrl,
  formatClaimDisplay,
  normalizeCompanyName,
  type CompanyAttributeClaim,
} from '../company';
import { lookupLocationCoordinates } from '../geoCoordinates';
import {
  ingestBuildinRuAbroad,
  ingestDriveCompanies,
  ingestNotionRelocation,
  ingestTelegraphCurrencyRemote,
  mergeCompanyRecords,
} from '../companyListIngestion';
import { CompanyRegistry, getCompanyRegistry } from '../companyRegistry';
import type { UnifiedVacancy } from '../unifiedVacancy';

describe('B201: Company Registry and Owner Lists with Provenance', () => {
  describe('Normalization and Domain Extraction', () => {
    it('normalizes company names consistently', () => {
      expect(normalizeCompanyName(' JetBrains ')).toBe('jetbrains');
      expect(normalizeCompanyName('MY.GAMES')).toBe('mygames');
      expect(normalizeCompanyName('Booking.com')).toBe('bookingcom');
      expect(normalizeCompanyName('1-Password')).toBe('1password');
    });

    it('extracts clean host domain from various career URLs', () => {
      expect(extractDomainFromUrl('https://www.beacon.com/careers')).toBe('beacon.com');
      expect(extractDomainFromUrl('https://my.games/careers/')).toBe('my.games');
      expect(extractDomainFromUrl('about.gitlab.com/jobs')).toBe('gitlab.com');
      expect(extractDomainFromUrl('https://soax.com/careers?ref=job')).toBe('soax.com');
      expect(extractDomainFromUrl('https://sub.agency.co.uk/careers')).toBe('agency.co.uk');
      expect(extractDomainFromUrl('https://careers.google.co.uk')).toBe('google.co.uk');
      expect(extractDomainFromUrl(undefined)).toBeUndefined();
      expect(extractDomainFromUrl('')).toBeUndefined();
      expect(extractDomainFromUrl('   ')).toBeUndefined();
    });
  });

  describe('Geocoding and Coordinates', () => {
    it('returns known coordinates for recognized tech hub cities and countries', () => {
      const amsterdam = lookupLocationCoordinates('Амстердам', 'Нидерланды');
      expect(amsterdam).toBeDefined();
      expect(amsterdam?.lat).toBeCloseTo(52.3676, 1);
      expect(amsterdam?.lng).toBeCloseTo(4.9041, 1);

      const berlin = lookupLocationCoordinates('Berlin', 'Germany');
      expect(berlin).toBeDefined();
      expect(berlin?.lat).toBeCloseTo(52.52, 1);

      const london = lookupLocationCoordinates('Лондон', 'Великобритания');
      expect(london).toBeDefined();
      expect(london?.lat).toBeCloseTo(51.5074, 1);

      const yerevan = lookupLocationCoordinates('Ереван', 'Армения');
      expect(yerevan).toBeDefined();
      expect(yerevan?.lat).toBeCloseTo(40.1792, 1);

      // Fallback to country coordinates
      const cyprusOnly = lookupLocationCoordinates(undefined, 'Кипр');
      expect(cyprusOnly).toBeDefined();
      expect(cyprusOnly?.lat).toBeCloseTo(35.1264, 1);
    });

    it('honestly returns undefined when city coordinates are unknown (no hallucination)', () => {
      const unknown = lookupLocationCoordinates('UnknownCity12345', 'UnknownLand');
      expect(unknown).toBeUndefined();
    });
  });

  describe('Claim Provenance and Honesty', () => {
    it('fixture: company claim from list without live vacancy shows claimed_by_source and is not a verified fact', () => {
      const claim: CompanyAttributeClaim = {
        key: 'relocation',
        value: true,
        status: 'claimed_by_source',
        provenance: {
          source: 'notion:160-relocating-companies',
          sourceLabel: 'Notion 160 компаний, которые релоцируют',
          readAt: '2026-09-05',
          rawNote: 'Свой иммиграционный отдел',
        },
      };

      const display = formatClaimDisplay(claim);
      expect(display.verified).toBe(false);
      expect(display.label).toBe('заявлено списком, не подтверждено');
      expect(display.source).toContain('Notion');
    });

    it('claim verified by live vacancy shows confirmed status', () => {
      const claim: CompanyAttributeClaim = {
        key: 'relocation',
        value: true,
        status: 'verified_by_live_vacancy',
        provenance: {
          source: 'notion:160-relocating-companies',
          sourceLabel: 'Notion 160 компаний',
          readAt: '2026-09-05',
        },
        verifiedAt: '2026-09-06T00:00:00.000Z',
        verifiedVacancyId: 'vac-123',
      };

      const display = formatClaimDisplay(claim);
      expect(display.verified).toBe(true);
      expect(display.label).toBe('подтверждено живой вакансией');
    });
  });

  describe('List Ingestion and Merging', () => {
    it('fixture: two records for one company from different lists merge into one company with two provenances without duplicate', () => {
      const notionItem = {
        region: 'Нидерланды',
        company: 'Miro',
        locations: 'Амстердам',
        industry: 'Collaboration',
        tier: '🟢 A',
        note: 'Релокационный пакет',
        source: 'notion:160-relocating-companies',
        readAt: '2026-09-05',
      };

      const buildinItem = {
        company: 'Miro',
        source: 'buildin:careerstation-ru-abroad',
        readAt: '2026-09-05',
        careersUrl: 'https://miro.com/careers',
        countries: 'Нидерланды 🇳🇱,США 🇺🇸',
        industry: 'SaaS,IT',
        linkedinUrl: 'https://www.linkedin.com/company/mirohq/',
      };

      const notionRecords = ingestNotionRelocation([notionItem]);
      const buildinRecords = ingestBuildinRuAbroad([buildinItem]);

      expect(notionRecords).toHaveLength(1);
      expect(buildinRecords).toHaveLength(1);

      const merged = mergeCompanyRecords([...notionRecords, ...buildinRecords]);

      expect(merged).toHaveLength(1);
      const miro = merged[0];
      expect(miro.name).toBe('Miro');
      expect(miro.domain).toBe('miro.com');
      expect(miro.careersUrl).toBe('https://miro.com/careers');
      expect(miro.linkedinUrl).toBe('https://www.linkedin.com/company/mirohq/');

      const claimSources = miro.attributes.map((a) => a.provenance.source);
      expect(claimSources).toContain('notion:160-relocating-companies');
      expect(claimSources).toContain('buildin:careerstation-ru-abroad');

      const relocClaim = miro.attributes.find((a) => a.key === 'relocation');
      expect(relocClaim).toBeDefined();
      expect(relocClaim?.status).toBe('claimed_by_source');

      const ruAbroadClaim = miro.attributes.find((a) => a.key === 'russian_founded_abroad');
      expect(ruAbroadClaim).toBeDefined();
      expect(ruAbroadClaim?.status).toBe('claimed_by_source');
    });

    it('ingests notion items with region only', () => {
      const notionItem = {
        region: 'Германия',
        company: 'RegionOnlyCo',
        source: 'notion:160-relocating-companies',
        readAt: '2026-09-05',
      };
      const records = ingestNotionRelocation([notionItem]);
      expect(records).toHaveLength(1);
      expect(records[0].locations[0].country).toBe('Германия');
    });

    it('ingests telegraph 240 currency remote items', () => {
      const items = [
        {
          n: 1,
          company: '10up',
          attribute: 'валютная удалёнка',
          source: 'telegraph:240-currency-remote',
          readAt: '2026-09-05',
          route: 'eu-prod',
        },
      ];
      const records = ingestTelegraphCurrencyRemote(items);
      expect(records).toHaveLength(1);
      expect(records[0].attributes[0].key).toBe('currency_remote');
    });

    it('ingests drive companies items and sets domain_tag', () => {
      const items = [
        {
          n: 1,
          company: 'GitLab',
          careersUrl: 'about.gitlab.com/jobs',
          sector: 'Dev Tools / SaaS',
          source: 'drive:job-search-resources-2026-03',
          readAt: '2026-09-05',
        },
      ];
      const records = ingestDriveCompanies(items);
      expect(records).toHaveLength(1);
      expect(records[0].domain).toBe('gitlab.com');
      expect(records[0].attributes[0].key).toBe('domain_tag');
    });
  });

  describe('CompanyRegistry and Vacancy Linking', () => {
    it('loads all 4 owner lists and links known ATS boards from B202', () => {
      const registry = new CompanyRegistry();
      registry.loadOwnerLists();

      const companies = registry.getAll();
      expect(companies.length).toBeGreaterThan(600);

      const miro = registry.findByName('Miro');
      expect(miro).toBeDefined();
      expect(miro?.atsProvider).toBe('ashby');
      expect(miro?.atsBoardToken).toBe('miro');

      const byId = registry.getById('comp-miro');
      expect(byId).toBeDefined();
      expect(byId?.name).toBe('Miro');

      const onePass = registry.findByName('1Password');
      expect(onePass).toBeDefined();
      expect(onePass?.atsProvider).toBe('ashby');
    });

    it('links live vacancies by domain and updates verifiedVacanciesCount', () => {
      const registry = new CompanyRegistry();
      registry.loadOwnerLists();

      const initialMiro = registry.findByName('Miro');
      expect(initialMiro?.verifiedVacanciesCount).toBe(0);

      const fakeVacancy: UnifiedVacancy = {
        id: 'vac-miro-01',
        fingerprint: 'fp-miro-01',
        title: 'Senior Frontend Engineer',
        company: 'Miro',
        location: 'Amsterdam, Netherlands',
        url: 'https://miro.com/careers/senior-frontend',
        description: 'Relocation package included. Remote possible.',
        requiredSkills: ['React', 'TypeScript'],
        provenance: {
          sourceType: 'json_api',
          sourceId: 'ats-ashby-miro',
          sourceUrl: 'https://api.ashbyhq.com/posting-api/job-board/miro',
          observedAt: '2026-09-06T01:00:00.000Z',
        },
        publishedAt: '2026-09-06T00:00:00.000Z',
        status: 'active',
      };

      const linked = registry.linkLiveVacancy(fakeVacancy);
      expect(linked).toBe(true);

      const updatedMiro = registry.findByName('Miro');
      expect(updatedMiro?.verifiedVacanciesCount).toBe(1);

      const relocClaim = updatedMiro?.attributes.find((a) => a.key === 'relocation');
      expect(relocClaim?.status).toBe('verified_by_live_vacancy');

      // Linking an unknown company returns false
      const unkVacancy: UnifiedVacancy = {
        id: 'vac-unknown',
        fingerprint: 'fp-unknown',
        title: 'Dev',
        company: 'UnknownNonExistentCompanyXYZ',
        url: 'https://unknown-non-existent-xyz-99.org/jobs',
        description: 'dev',
        requiredSkills: [],
        provenance: {
          sourceType: 'rss',
          sourceId: 'rss-test',
          sourceUrl: 'https://unknown.org/rss',
          observedAt: '2026-09-06T01:00:00.000Z',
        },
        publishedAt: '2026-09-06T00:00:00.000Z',
        status: 'active',
      };
      expect(registry.linkLiveVacancy(unkVacancy)).toBe(false);
    });

    it('filters companies by various facets, pagination and search', () => {
      const registry = new CompanyRegistry();
      registry.loadOwnerLists();

      const relocating = registry.filter({ relocation: true });
      expect(relocating.length).toBeGreaterThan(100);

      const currencyRemote = registry.filter({ currencyRemote: true });
      expect(currencyRemote.length).toBeGreaterThan(150);

      const ruAbroad = registry.filter({ russianAbroad: true });
      expect(ruAbroad.length).toBeGreaterThan(150);

      const inNetherlands = registry.filter({ country: 'Нидерланды' });
      expect(inNetherlands.length).toBeGreaterThan(20);

      const inAmsterdam = registry.filter({ city: 'Амстердам' });
      expect(inAmsterdam.length).toBeGreaterThan(5);

      const withAts = registry.filter({ hasAtsBoard: true });
      expect(withAts.length).toBeGreaterThan(30);

      const searchMiro = registry.filter({ search: 'miro' });
      expect(searchMiro.length).toBeGreaterThan(0);

      const paginated = registry.filter({ limit: 10, offset: 5 });
      expect(paginated).toHaveLength(10);
    });

    it('computes accurate registry stats', () => {
      const registry = new CompanyRegistry();
      registry.loadOwnerLists();
      const stats = registry.getStats();

      expect(stats.totalCompanies).toBeGreaterThan(600);
      expect(stats.withRelocation).toBeGreaterThan(100);
      expect(stats.withCurrencyRemote).toBeGreaterThan(150);
      expect(stats.withRussianAbroad).toBeGreaterThan(150);
      expect(stats.withAtsBoards).toBeGreaterThan(30);
      expect(stats.withCoordinates).toBeGreaterThan(100);
    });

    it('singleton getCompanyRegistry returns initialized registry', () => {
      const reg = getCompanyRegistry();
      expect(reg.getAll().length).toBeGreaterThan(600);
    });
  });
});
