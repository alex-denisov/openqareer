import type { RegisteredVacancySource, VacancySourceMeasurement } from './defaultVacancySources';

/**
 * Карьерные сайты на Workday (B216).
 *
 * Workday — не ATS-доска в смысле B202 (у тех один адрес на слаг), а
 * тенант с собственным хостом и именем сайта: `<tenant>.wd<N>.myworkdayjobs.com`
 * и `/wday/cxs/<tenant>/<site>/jobs`. Имя сайта угадать нельзя — неверное
 * отвечает `422`, — поэтому здесь только те, что ответили списком с прод-VM
 * 2026-09-14, и с числом `total` из того ответа.
 *
 * Список Workday отдаёт по 20 записей без описания: карточка несёт заголовок и
 * место, публичная ссылка собирается из адреса сайта. Полный текст — отдельный
 * запрос на каждую вакансию, и на 1 744 вакансиях NVIDIA это отдельный срез.
 *
 * Статус 9 компаний, ранее предполагавшихся на Workday и дававших 422 (B216/B217):
 * - Qualcomm: Eightfold AI (careers.qualcomm.com), интегрирован как источник src-qualcomm-careers.
 * - Snap: Workday (snapchat/snap), подтверждён и подключен в MEASURED_WORKDAY_TENANTS.
 * - Sony: Workday (sonyglobal/SonyGlobalCareers), подтверждён и подключен в MEASURED_WORKDAY_TENANTS.
 * - VMware: поглощена Broadcom, активна под доской Broadcom Workday (ats-workday-broadcom).
 * - AMD: использует iCIMS (careers-amd.icims.com), не Workday.
 * - Dell: использует Oracle Cloud HCM, не Workday.
 * - Cisco: использует Phenom People (jobs.cisco.com), не Workday.
 * - JPMC: использует Oracle Cloud HCM, не Workday.
 * - IBM: использует IBM Kenexa / BrassRing (ibm.com/careers), не Workday.
 */

const UNRESOLVED_WORKDAY_COMPANY_STATUS: Readonly<Record<string, string>> = {
  amd: 'Uses iCIMS (careers-amd.icims.com), not Workday',
  dell: 'Uses Oracle Cloud HCM, not Workday',
  cisco: 'Uses Phenom People (jobs.cisco.com), not Workday',
  jpmc: 'Uses Oracle Cloud HCM, not Workday',
  jpmorgan: 'Uses Oracle Cloud HCM, not Workday',
  'jp morgan': 'Uses Oracle Cloud HCM, not Workday',
  'jp morgan chase': 'Uses Oracle Cloud HCM, not Workday',
  ibm: 'Uses IBM Kenexa / BrassRing (ibm.com/careers), not Workday',
  qualcomm: 'Uses Eightfold AI (careers.qualcomm.com), integrated as src-qualcomm-careers, not Workday',
  vmware: "Acquired by Broadcom; active under Broadcom's Workday board (ats-workday-broadcom)",
};

/**
 * Возвращает проверенную причину, по которой компания не подключена как отдельный тенант Workday,
 * чтобы будущие интеграции не подбирали невалидные адреса Workday с ошибками 422.
 */
export function getUnresolvedWorkdayCompanyStatus(company: string): string | undefined {
  const normalized = company.trim().toLowerCase();
  return UNRESOLVED_WORKDAY_COMPANY_STATUS[normalized];
}

export interface MeasuredWorkdayTenant {
  readonly company: string;
  readonly tenant: string;
  readonly host: string;
  readonly site: string;
  readonly jobs: number;
  readonly observedAt: string;
}

export const MEASURED_WORKDAY_TENANTS: readonly MeasuredWorkdayTenant[] = [
  {
    company: 'NVIDIA',
    tenant: 'nvidia',
    host: 'nvidia.wd5.myworkdayjobs.com',
    site: 'NVIDIAExternalCareerSite',
    jobs: 1744,
    observedAt: '2026-09-14',
  },
  {
    company: 'Salesforce',
    tenant: 'salesforce',
    host: 'salesforce.wd12.myworkdayjobs.com',
    site: 'External_Career_Site',
    jobs: 1443,
    observedAt: '2026-09-14',
  },
  {
    company: 'Adobe',
    tenant: 'adobe',
    host: 'adobe.wd5.myworkdayjobs.com',
    site: 'external_experienced',
    jobs: 739,
    observedAt: '2026-09-14',
  },
  {
    company: 'Intel',
    tenant: 'intel',
    host: 'intel.wd1.myworkdayjobs.com',
    site: 'External',
    jobs: 588,
    observedAt: '2026-09-14',
  },
  {
    company: 'Autodesk',
    tenant: 'autodesk',
    host: 'autodesk.wd1.myworkdayjobs.com',
    site: 'Ext',
    jobs: 403,
    observedAt: '2026-09-14',
  },
  {
    company: 'PayPal',
    tenant: 'paypal',
    host: 'paypal.wd1.myworkdayjobs.com',
    site: 'jobs',
    jobs: 134,
    observedAt: '2026-09-14',
  },
  {
    company: 'eBay',
    tenant: 'ebay',
    host: 'ebay.wd5.myworkdayjobs.com',
    site: 'apply',
    jobs: 307,
    observedAt: '2026-09-14',
  },
  {
    company: 'HP',
    tenant: 'hp',
    host: 'hp.wd5.myworkdayjobs.com',
    site: 'ExternalCareerSite',
    jobs: 844,
    observedAt: '2026-09-14',
  },
  {
    company: 'Workday',
    tenant: 'workday',
    host: 'workday.wd5.myworkdayjobs.com',
    site: 'Workday',
    jobs: 391,
    observedAt: '2026-09-14',
  },
  {
    company: 'Broadcom',
    tenant: 'broadcom',
    host: 'broadcom.wd1.myworkdayjobs.com',
    site: 'External_Career',
    jobs: 369,
    observedAt: '2026-09-14',
  },
  {
    company: 'Capital One',
    tenant: 'capitalone',
    host: 'capitalone.wd12.myworkdayjobs.com',
    site: 'Capital_One',
    jobs: 1939,
    observedAt: '2026-09-14',
  },
  {
    company: 'Snap',
    tenant: 'snapchat',
    host: 'snapchat.wd1.myworkdayjobs.com',
    site: 'snap',
    jobs: 176,
    observedAt: '2026-09-14',
  },
  {
    company: 'Sony',
    tenant: 'sonyglobal',
    host: 'sonyglobal.wd1.myworkdayjobs.com',
    site: 'SonyGlobalCareers',
    jobs: 113,
    observedAt: '2026-09-14',
  },
];

/** Карьерный сайт меняется медленно, как и доска ATS: дважды в сутки. */
const WORKDAY_REFRESH_INTERVAL_MINUTES = 720;

export const WORKDAY_SOURCE_PREFIX = 'ats-workday-';

export function workdaySourceId(tenant: string): string {
  return `${WORKDAY_SOURCE_PREFIX}${tenant}`;
}

export function workdayListUrl(measured: MeasuredWorkdayTenant): string {
  return `https://${measured.host}/wday/cxs/${measured.tenant}/${measured.site}/jobs`;
}

export function workdayBoardSource(measured: MeasuredWorkdayTenant): RegisteredVacancySource {
  return {
    id: workdaySourceId(measured.tenant),
    name: measured.company,
    type: 'json_api',
    accessClass: 'api',
    market: 'Свой карьерный сайт работодателя (Workday)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: workdayListUrl(measured),
    refreshIntervalMinutes: WORKDAY_REFRESH_INTERVAL_MINUTES,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

export const WORKDAY_BOARD_SOURCES: readonly RegisteredVacancySource[] =
  MEASURED_WORKDAY_TENANTS.map(workdayBoardSource);

export const WORKDAY_BOARD_MEASUREMENTS: Readonly<
  Record<string, readonly VacancySourceMeasurement[]>
> = Object.fromEntries(
  MEASURED_WORKDAY_TENANTS.map((measured) => [
    workdaySourceId(measured.tenant),
    [
      {
        items: measured.jobs,
        observedAt: measured.observedAt,
        route: 'eu-prod' as const,
        note: `total из ответа списка Workday; robots.txt тенанта разрешает /${measured.site}/`,
      },
    ],
  ]),
);
