import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { normalizeJsonSource } from './jsonSourceAdapters';
import {
  WorkdayDescriptionBackfill,
  mergeWorkdaySnapshot,
  readWorkdayDescription,
  workdayDetailUrl,
  type WorkdayDescriptionPool,
  type WorkdayDetailResponse,
} from './workdayDescriptions';

const PUBLIC_URL =
  'https://sonyglobal.wd1.myworkdayjobs.com/SonyGlobalCareers/job/Weybridge/Data-Quality_JR-119746-1';

function vacancy(id: string, sourceId: string, url = PUBLIC_URL): UnifiedVacancy {
  return {
    id,
    fingerprint: id,
    title: 'Data Quality Intern',
    company: 'Sony',
    location: 'Weybridge',
    description: '',
    requiredSkills: [],
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: url,
      observedAt: '2026-10-20T00:00:00Z',
    },
    publishedAt: '2026-10-19T00:00:00Z',
    status: 'active',
  };
}

const DETAIL_HTML =
  '<p><b>About the role</b></p><p>You will build Python and SQL pipelines for data quality.</p><ul><li>Own dashboards</li></ul>';

class FakePool implements WorkdayDescriptionPool {
  readonly merged: Array<{ sourceId: string; vacancies: UnifiedVacancy[] }> = [];
  readonly expired: string[] = [];
  constructor(private readonly rows: Map<string, UnifiedVacancy[]>) {}
  loadVacanciesWithoutFullText(sourceId: string, limit: number, excludeIds: readonly string[]) {
    return (this.rows.get(sourceId) ?? [])
      .filter((v) => !excludeIds.includes(v.id))
      .slice(0, limit);
  }
  mergeSourceSlice(sourceId: string, vacancies: readonly UnifiedVacancy[]) {
    this.merged.push({ sourceId, vacancies: [...vacancies] });
    const kept = (this.rows.get(sourceId) ?? []).filter(
      (row) => !vacancies.some((v) => v.id === row.id),
    );
    this.rows.set(sourceId, kept);
    return { removed: [] };
  }
  markExpired(ids: readonly string[]) {
    this.expired.push(...ids);
    for (const [sourceId, list] of this.rows) {
      this.rows.set(
        sourceId,
        list.filter((row) => !ids.includes(row.id)),
      );
    }
    return ids.length;
  }
}

describe('workdayDetailUrl', () => {
  it('builds the cxs detail address from the public link and the tenant in the source id', () => {
    expect(workdayDetailUrl('ats-workday-sonyglobal', PUBLIC_URL)).toBe(
      'https://sonyglobal.wd1.myworkdayjobs.com/wday/cxs/sonyglobal/SonyGlobalCareers/job/Weybridge/Data-Quality_JR-119746-1',
    );
  });

  it('refuses a foreign host, a non-Workday source or a broken link', () => {
    expect(workdayDetailUrl('ats-workday-sony', 'https://evil.example/x/job/1')).toBeUndefined();
    expect(workdayDetailUrl('ats-greenhouse-x', PUBLIC_URL)).toBeUndefined();
    expect(workdayDetailUrl('ats-workday-sonyglobal', 'not a url')).toBeUndefined();
  });
});

describe('readWorkdayDescription', () => {
  it('turns jobPostingInfo.jobDescription HTML into text', () => {
    const text = readWorkdayDescription({ jobPostingInfo: { jobDescription: DETAIL_HTML } });
    expect(text).toContain('About the role');
    expect(text).toContain('Python and SQL pipelines');
    expect(text).not.toContain('<p>');
  });

  it('returns an empty string when the payload has no description', () => {
    expect(readWorkdayDescription({})).toBe('');
    expect(readWorkdayDescription(null)).toBe('');
  });
});

describe('mergeWorkdaySnapshot', () => {
  it('keeps the loaded text when the list returns the record again without one', () => {
    const stored = {
      ...vacancy('w:1', 'ats-workday-sonyglobal'),
      description: 'About the role',
      fullDescription: 'About the role. Python.',
      requiredSkills: ['Python'],
    };
    const incoming = { ...vacancy('w:1', 'ats-workday-sonyglobal'), title: 'Renamed' };
    const merged = mergeWorkdaySnapshot(stored, incoming);
    expect(merged.title).toBe('Renamed');
    expect(merged.fullDescription).toBe('About the role. Python.');
    expect(merged.description).toBe('About the role');
    expect(merged.requiredSkills).toEqual(['Python']);
  });

  it('does not keep the old "title — city" stand-in when no text was loaded', () => {
    const stored = {
      ...vacancy('w:1', 'ats-workday-sonyglobal'),
      description: 'Intern — Weybridge',
    };
    const merged = mergeWorkdaySnapshot(stored, vacancy('w:1', 'ats-workday-sonyglobal'));
    expect(merged.description).toBe('');
    expect(merged.fullDescription).toBeUndefined();
  });
});

describe('WorkdayDescriptionBackfill', () => {
  const sony = 'ats-workday-sonyglobal';
  const nvidia = 'ats-workday-nvidia';
  const nvidiaUrl =
    'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/Engineer_JR1';

  function detail(status: number, html = DETAIL_HTML): WorkdayDetailResponse {
    return {
      status,
      payload: status === 200 ? { jobPostingInfo: { jobDescription: html } } : undefined,
    };
  }

  it('loads the text into fullDescription, a short description and skills', async () => {
    const pool = new FakePool(new Map([[sony, [vacancy('s:1', sony)]]]));
    const requested: string[] = [];
    const backfill = new WorkdayDescriptionBackfill({
      pool,
      sourceIds: () => [sony],
      fetchDetail: async (url) => {
        requested.push(url);
        return detail(200);
      },
      sleep: async () => undefined,
    });
    const report = await backfill.step();
    expect(report).toMatchObject({ requested: 1, loaded: 1, gone: 0, failed: 0 });
    expect(requested[0]).toContain('/wday/cxs/sonyglobal/SonyGlobalCareers/job/');
    const saved = pool.merged[0]!.vacancies[0]!;
    expect(saved.fullDescription).toContain('Python and SQL pipelines');
    expect(saved.description.length).toBeGreaterThan(0);
    expect(saved.description.length).toBeLessThanOrEqual(500);
    expect(saved.requiredSkills).toEqual(expect.arrayContaining(['Python']));
  });

  it('asks each host for at most perSource records per tick, hosts side by side', async () => {
    const pool = new FakePool(
      new Map([
        [sony, [1, 2, 3].map((n) => vacancy(`s:${n}`, sony))],
        [nvidia, [1, 2, 3].map((n) => vacancy(`n:${n}`, nvidia, nvidiaUrl))],
      ]),
    );
    const backfill = new WorkdayDescriptionBackfill({
      pool,
      sourceIds: () => [sony, nvidia],
      fetchDetail: async () => detail(200),
      sleep: async () => undefined,
      perSource: 2,
    });
    const report = await backfill.step();
    expect(report.requested).toBe(4);
    expect(pool.merged.filter((m) => m.sourceId === sony)).toHaveLength(2);
    expect(pool.merged.filter((m) => m.sourceId === nvidia)).toHaveLength(2);
  });

  it('retires a vacancy the employer removed (404) instead of retrying it', async () => {
    const pool = new FakePool(new Map([[sony, [vacancy('s:1', sony)]]]));
    const backfill = new WorkdayDescriptionBackfill({
      pool,
      sourceIds: () => [sony],
      fetchDetail: async () => detail(404),
      sleep: async () => undefined,
    });
    expect(await backfill.step()).toMatchObject({ gone: 1 });
    expect(pool.expired).toEqual(['s:1']);
  });

  it('retries a failed record on later ticks and gives up after maxAttempts', async () => {
    const pool = new FakePool(new Map([[sony, [vacancy('s:1', sony)]]]));
    let calls = 0;
    const backfill = new WorkdayDescriptionBackfill({
      pool,
      sourceIds: () => [sony],
      fetchDetail: async () => {
        calls += 1;
        if (calls === 3) throw new Error('network');
        return detail(503);
      },
      sleep: async () => undefined,
      maxAttempts: 3,
    });
    for (let tick = 0; tick < 5; tick += 1) await backfill.step();
    expect(calls).toBe(3);
    expect(pool.merged).toHaveLength(0);
    expect(pool.expired).toHaveLength(0);
  });

  it('counts a record with an empty description as failed, not as loaded', async () => {
    const pool = new FakePool(new Map([[sony, [vacancy('s:1', sony)]]]));
    const backfill = new WorkdayDescriptionBackfill({
      pool,
      sourceIds: () => [sony],
      fetchDetail: async () => detail(200, '   '),
      sleep: async () => undefined,
    });
    expect(await backfill.step()).toMatchObject({ loaded: 0, failed: 1 });
    expect(pool.merged).toHaveLength(0);
  });
});

describe('MultiSourceVacancyEngine.runWorkdayDescriptionStep', () => {
  it('loads text only for enabled live Workday sources of the registry', async () => {
    const { MultiSourceVacancyEngine } = await import('./multiSourceVacancyEngine');
    const { WORKDAY_BOARD_SOURCES } = await import('./workdayBoardSources');
    const sonySource = WORKDAY_BOARD_SOURCES.find((s) => s.id === 'ats-workday-sonyglobal')!;
    const nvidiaSource = {
      ...WORKDAY_BOARD_SOURCES.find((s) => s.id === 'ats-workday-nvidia')!,
      enabled: false,
    };
    const requested: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      sources: [sonySource, nvidiaSource],
      workdayDetailFetch: async (url) => {
        requested.push(url);
        return { status: 200, payload: { jobPostingInfo: { jobDescription: DETAIL_HTML } } };
      },
    });
    const pool = (engine as unknown as { pool: WorkdayDescriptionPool }).pool;
    pool.mergeSourceSlice('ats-workday-sonyglobal', [
      vacancy('ats-workday-sonyglobal:1', 'ats-workday-sonyglobal'),
    ]);
    pool.mergeSourceSlice('ats-workday-nvidia', [
      vacancy(
        'ats-workday-nvidia:1',
        'ats-workday-nvidia',
        'https://nvidia.wd5.myworkdayjobs.com/S/job/US/E_1',
      ),
    ]);

    const report = await engine.runWorkdayDescriptionStep();
    expect(report).toMatchObject({ requested: 1, loaded: 1 });
    expect(requested).toHaveLength(1);
    expect(engine.getVacancy('ats-workday-sonyglobal:1')?.fullDescription).toContain('Python');
  });
});

describe('Workday list adapter', () => {
  it('does not pass "title — city" off as a description', () => {
    const [listed] = normalizeJsonSource(
      'ats-workday-nvidia',
      {
        total: 1,
        jobPostings: [
          {
            title: 'Senior Firmware Engineer',
            externalPath: '/job/US-CA-Santa-Clara/Senior-Firmware-Engineer_JR1999599',
            locationsText: 'US, CA, Santa Clara',
            postedOn: 'Posted Today',
            bulletFields: ['JR1999599'],
          },
        ],
      },
      {
        observedAt: '2026-10-20T00:00:00.000Z',
        sourceName: 'NVIDIA',
        sourceUrl:
          'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs',
      },
    );
    expect(listed?.title).toBe('Senior Firmware Engineer');
    expect(listed?.description).toBe('');
    expect(listed?.fullDescription).toBeUndefined();
  });
});
