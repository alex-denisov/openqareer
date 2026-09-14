import { describe, expect, it } from 'vitest';
import {
  MEASURED_WORKDAY_TENANTS,
  WORKDAY_BOARD_MEASUREMENTS,
  WORKDAY_BOARD_SOURCES,
  workdayListUrl,
  workdaySourceId,
} from './workdayBoardSources';

describe('workdayBoardSources', () => {
  it('includes verified live tenant configuration for Snap', () => {
    const snap = MEASURED_WORKDAY_TENANTS.find((t) => t.company === 'Snap');
    expect(snap).toBeDefined();
    expect(snap).toMatchObject({
      company: 'Snap',
      tenant: 'snapchat',
      host: 'snapchat.wd1.myworkdayjobs.com',
      site: 'snap',
      jobs: 176,
      observedAt: '2026-09-14',
    });

    const sourceId = workdaySourceId(snap!.tenant);
    expect(sourceId).toBe('ats-workday-snapchat');
    expect(workdayListUrl(snap!)).toBe(
      'https://snapchat.wd1.myworkdayjobs.com/wday/cxs/snapchat/snap/jobs',
    );

    const source = WORKDAY_BOARD_SOURCES.find((s) => s.id === sourceId);
    expect(source).toBeDefined();
    expect(source?.enabled).toBe(true);
    expect(source?.accessClass).toBe('api');
    expect(source?.type).toBe('json_api');

    const measurements = WORKDAY_BOARD_MEASUREMENTS[sourceId];
    expect(measurements).toBeDefined();
    expect(measurements?.[0]).toMatchObject({
      items: 176,
      observedAt: '2026-09-14',
      route: 'eu-prod',
    });
  });

  it('includes verified live tenant configuration for Sony', () => {
    const sony = MEASURED_WORKDAY_TENANTS.find((t) => t.company === 'Sony');
    expect(sony).toBeDefined();
    expect(sony).toMatchObject({
      company: 'Sony',
      tenant: 'sonyglobal',
      host: 'sonyglobal.wd1.myworkdayjobs.com',
      site: 'SonyGlobalCareers',
      jobs: 113,
      observedAt: '2026-09-14',
    });

    const sourceId = workdaySourceId(sony!.tenant);
    expect(sourceId).toBe('ats-workday-sonyglobal');
    expect(workdayListUrl(sony!)).toBe(
      'https://sonyglobal.wd1.myworkdayjobs.com/wday/cxs/sonyglobal/SonyGlobalCareers/jobs',
    );

    const source = WORKDAY_BOARD_SOURCES.find((s) => s.id === sourceId);
    expect(source).toBeDefined();
    expect(source?.enabled).toBe(true);
    expect(source?.accessClass).toBe('api');
    expect(source?.type).toBe('json_api');

    const measurements = WORKDAY_BOARD_MEASUREMENTS[sourceId];
    expect(measurements).toBeDefined();
    expect(measurements?.[0]).toMatchObject({
      items: 113,
      observedAt: '2026-09-14',
      route: 'eu-prod',
    });
  });
});
