import { describe, expect, it } from 'vitest';
import {
  MEASURED_WORKDAY_TENANTS,
  WORKDAY_BOARD_MEASUREMENTS,
  WORKDAY_BOARD_SOURCES,
  getUnresolvedWorkdayCompanyStatus,
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

  it('returns the architectural rationale for unresolved Workday candidates', () => {
    // AMD uses iCIMS
    const amdStatus = getUnresolvedWorkdayCompanyStatus('AMD');
    expect(amdStatus).toBeDefined();
    expect(amdStatus).toContain('iCIMS');
    expect(amdStatus).toContain('careers-amd.icims.com');

    // Dell uses Oracle Cloud HCM
    const dellStatus = getUnresolvedWorkdayCompanyStatus('Dell');
    expect(dellStatus).toBeDefined();
    expect(dellStatus).toContain('Oracle Cloud HCM');

    // Cisco uses Phenom People
    const ciscoStatus = getUnresolvedWorkdayCompanyStatus('Cisco');
    expect(ciscoStatus).toBeDefined();
    expect(ciscoStatus).toContain('Phenom People');
    expect(ciscoStatus).toContain('jobs.cisco.com');

    // JPMC uses Oracle Cloud HCM
    const jpmcStatus = getUnresolvedWorkdayCompanyStatus('JPMC');
    expect(jpmcStatus).toBeDefined();
    expect(jpmcStatus).toContain('Oracle Cloud HCM');

    // IBM uses IBM Kenexa / BrassRing
    const ibmStatus = getUnresolvedWorkdayCompanyStatus('IBM');
    expect(ibmStatus).toBeDefined();
    expect(ibmStatus).toContain('BrassRing');
    expect(ibmStatus).toContain('ibm.com/careers');

    // Qualcomm uses Eightfold AI (src-qualcomm-careers)
    const qualcommStatus = getUnresolvedWorkdayCompanyStatus('Qualcomm');
    expect(qualcommStatus).toBeDefined();
    expect(qualcommStatus).toContain('Eightfold');
    expect(qualcommStatus).toContain('careers.qualcomm.com');

    // VMware acquired by Broadcom (ats-workday-broadcom)
    const vmwareStatus = getUnresolvedWorkdayCompanyStatus('VMware');
    expect(vmwareStatus).toBeDefined();
    expect(vmwareStatus).toContain('Broadcom');
    expect(vmwareStatus).toContain('ats-workday-broadcom');

    // Case-insensitive checks
    expect(getUnresolvedWorkdayCompanyStatus('amd')).toBe(amdStatus);
    expect(getUnresolvedWorkdayCompanyStatus('DELL')).toBe(dellStatus);

    // Companies verified on Workday or unknown should return undefined
    expect(getUnresolvedWorkdayCompanyStatus('Snap')).toBeUndefined();
    expect(getUnresolvedWorkdayCompanyStatus('Sony')).toBeUndefined();
    expect(getUnresolvedWorkdayCompanyStatus('UnknownCorp')).toBeUndefined();
  });

  it('verifies that all 13 measured Workday tenants have valid urls, live status, and verified measurements', () => {
    expect(MEASURED_WORKDAY_TENANTS).toHaveLength(13);

    for (const tenant of MEASURED_WORKDAY_TENANTS) {
      expect(tenant.company).toBeTruthy();
      expect(tenant.tenant).toBeTruthy();
      expect(tenant.host).toBeTruthy();
      expect(tenant.site).toBeTruthy();
      expect(tenant.jobs).toBeGreaterThan(0);
      expect(tenant.observedAt).toBeTruthy();

      const targetUrl = workdayListUrl(tenant);
      expect(targetUrl).toBe(
        `https://${tenant.host}/wday/cxs/${tenant.tenant}/${tenant.site}/jobs`,
      );
      expect(() => new URL(targetUrl)).not.toThrow();

      const sourceId = workdaySourceId(tenant.tenant);
      const source = WORKDAY_BOARD_SOURCES.find((s) => s.id === sourceId);
      expect(source).toBeDefined();
      expect(source?.name).toBe(tenant.company);
      expect(source?.addressStatus).toBe('live');
      expect(source?.enabled).toBe(true);
      expect(source?.type).toBe('json_api');
      expect(source?.accessClass).toBe('api');
      expect(source?.targetUrl).toBe(targetUrl);

      const measurements = WORKDAY_BOARD_MEASUREMENTS[sourceId];
      expect(measurements).toBeDefined();
      expect(measurements?.length).toBeGreaterThan(0);
      expect(measurements?.[0].items).toBe(tenant.jobs);
      expect(measurements?.[0].observedAt).toBe(tenant.observedAt);
      expect(measurements?.[0].route).toBe('eu-prod');
      expect(measurements?.[0].note).toContain(tenant.site);
    }
  });
});

