import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { htmlToFeedText } from '../connectors/feedText';
import {
  asArray,
  buildJsonVacancy,
  fromEpochMilliseconds,
  fromLooseDate,
  isUsableVacancy,
  record,
  text,
  UNREADABLE,
  type JsonAdapterContext,
  type JsonRecord,
} from './jsonVacancyRecord';

export type WaveAtsProvider =
  | 'phenom'
  | 'successfactors'
  | 'jazzhr'
  | 'rippling'
  | 'comeet'
  | 'hibob'
  | 'gem'
  | 'manatal'
  | 'deel'
  | 'careerplug'
  | 'apploi'
  | 'ukg'
  | 'ukgready'
  | 'hireology'
  | 'isolvedhire'
  | 'dayforce'
  | 'adp'
  | 'applicantpro'
  | 'zohorecruit'
  | 'paycor'
  | 'betterteam'
  | 'gupy'
  | 'hiringthing'
  | 'solides'
  | 'factorial'
  | 'hrmdirect'
  | 'gusto'
  | 'taleo'
  | 'eightfold'
  | 'huntflow'
  | 'avature'
  | 'cornerstone'
  | 'pageup'
  | 'workstream'
  | 'freshteam'
  | 'applitrack'
  | 'trakstar'
  | 'inhire'
  | 'talentlyft'
  | 'jobscore'
  | 'peopleforce';

export interface WaveAtsSpec {
  readonly provider: WaveAtsProvider;
  readonly name: string;
  readonly endpoint: (board: string) => string;
  readonly boardUrl: (board: string) => string;
  readonly measuredAt: string;
  readonly robotsNote: string;
  readonly items: (payload: unknown) => readonly unknown[] | null;
  readonly extract?: (raw: JsonRecord, board: string, companyFallback: string) => PartialWaveFields;
}

interface PartialWaveFields {
  readonly externalId: string;
  readonly title: string;
  readonly company?: string;
  readonly location?: string;
  readonly isRemote?: boolean;
  readonly description?: string;
  readonly url: string;
  readonly employmentType?: string;
  readonly publishedAt?: string;
}

function arrAt(payload: unknown, ...keys: string[]): readonly unknown[] | null {
  if (keys.length === 0) return Array.isArray(payload) ? payload : null;
  let cur: unknown = payload;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = (cur as JsonRecord)[k];
  }
  return Array.isArray(cur) ? cur : null;
}

const arrRoot = (p: unknown) => (Array.isArray(p) ? p : null);
const arrJobs = (p: unknown) => arrAt(p, 'jobs');
const arrData = (p: unknown) => arrAt(p, 'data');
const arrResults = (p: unknown) => arrAt(p, 'results');

function splitBoard(board: string, sep = '/'): [string, string, string] {
  const parts = board.split(sep);
  return [parts[0] ?? board, parts[1] ?? '', parts[2] ?? ''];
}

function firstStr(obj: JsonRecord, keys: readonly string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function extractLocation(raw: JsonRecord): string {
  const direct = firstStr(raw, ['location', 'location_display', 'primaryLocation', 'jobLocation', 'site']);
  if (direct) return direct;
  const locObj = raw.location && typeof raw.location === 'object' ? record(raw.location) : undefined;
  if (locObj) {
    const l = firstStr(locObj, ['name', 'label']);
    if (l) return l;
  }
  const branch = raw.branch && typeof raw.branch === 'object' ? record(raw.branch) : undefined;
  const parts = [
    firstStr(raw, ['city', 'City']) || (branch ? firstStr(branch, ['city']) : ''),
    firstStr(raw, ['state', 'State']),
    firstStr(raw, ['country', 'Country', 'country_id']) || (branch ? firstStr(branch, ['country']) : ''),
  ].filter(Boolean);
  return parts.join(', ');
}

function extractRemote(raw: JsonRecord, title: string, location: string): boolean {
  for (const k of ['isRemote', 'is_remote', 'remote', 'Remote_Job', 'IsRemote', 'isRemoteWork']) {
    if (raw[k] === true) return true;
  }
  const nestedLoc = raw.workLocation && typeof raw.workLocation === 'object' ? record(raw.workLocation) : record(raw.location);
  if (nestedLoc.isRemote === true || nestedLoc.is_remote === true) return true;
  const opt = firstStr(raw, ['work_location_option', 'workplaceType']).toLowerCase();
  if (opt === 'remote') return true;
  return /\bremote\b/i.test(title) || /\bremote\b/i.test(location);
}

function extractPublishedAt(raw: JsonRecord): string | undefined {
  if (typeof raw.t_create === 'number') {
    return fromEpochMilliseconds(raw.t_create > 1e12 ? raw.t_create : raw.t_create * 1000);
  }
  return fromLooseDate(
    raw.publishedAt ??
      raw.published_at ??
      raw.publishedDate ??
      raw.postedDate ??
      raw.PostedDate ??
      raw.postDate ??
      raw.createdAt ??
      raw.created_at ??
      raw.created ??
      raw.updated_at ??
      raw.time_updated ??
      raw.original_open_date ??
      raw.Date_Opened,
  );
}

function standardExtract(raw: JsonRecord, companyFallback: string): PartialWaveFields {
  const title = firstStr(raw, ['title', 'name', 'position', 'displayName', 'Job_Opening_Name', 'requisitionTitle', 'Title', 'unifiedStandardTitle']);
  const location = extractLocation(raw);
  const url = firstStr(raw, ['url', 'applyUrl', 'apply_url', 'absolute_url', 'position_url', 'applicant_apply_link', 'canonicalPositionUrl', 'jobUrl', 'shortUrl', 'Url']);
  const desc = htmlToFeedText(
    firstStr(raw, ['description', 'descriptionTeaser', 'content', 'body', 'Job_Description', 'job_description', 'BriefDescription', 'Description']) || title,
  );
  return {
    externalId: firstStr(raw, ['id', 'uuid', 'uid', 'jobId', 'JobId', 'itemID', 'Id', 'jobSeqNo']),
    title,
    company: firstStr(raw, ['companyName']) || companyFallback,
    location: location || undefined,
    isRemote: extractRemote(raw, title, location),
    description: desc || title,
    url,
    employmentType: firstStr(raw, ['employmentType', 'employment_type', 'contract_type', 'type']) || undefined,
    publishedAt: extractPublishedAt(raw),
  };
}

export const WAVE_ATS_SPECS: readonly WaveAtsSpec[] = [
  // Wave 1 (9)
  {
    provider: 'phenom',
    name: 'Phenom People',
    endpoint: (b) => `https://${b}/widgets`,
    boardUrl: (b) => `https://${b}/`,
    measuredAt: '2026-11-27',
    robotsNote: 'Wave 1: Phenom /widgets POST/GET public job search feed',
    items: (p) => arrAt(p, 'refineSearch', 'data', 'jobs'),
  },
  {
    provider: 'successfactors',
    name: 'SAP SuccessFactors',
    endpoint: (b) => `https://${b}/services/recruiting/v1/jobs`,
    boardUrl: (b) => `https://${b}/`,
    measuredAt: '2026-11-27',
    robotsNote: 'Wave 1: SuccessFactors recruiting v1/jobs & sitemap.xml',
    items: (p) => arrAt(p, 'jobSearchResult'),
    extract: (raw, _b, fallback) => standardExtract(record(raw.response ?? raw), fallback),
  },
  {
    provider: 'jazzhr',
    name: 'JazzHR',
    endpoint: (b) => `https://api.resumatorapi.com/v1/jobs/board_code/${b}`,
    boardUrl: (b) => `https://${b}.applytojob.com/apply`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 1: JazzHR public board_code feed',
    items: arrRoot,
    extract: (raw, board, fallback) => {
      const f = standardExtract(raw, fallback);
      return { ...f, url: f.url || (f.externalId ? `https://${board}.applytojob.com/apply/${f.externalId}` : '') };
    },
  },
  {
    provider: 'rippling',
    name: 'Rippling ATS',
    endpoint: (b) => `https://api.rippling.com/platform/api/ats/v1/board/${b}/jobs`,
    boardUrl: (b) => `https://ats.rippling.com/${b}/jobs`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 1: Rippling public ATS board JSON',
    items: arrRoot,
    extract: (raw, _b, fallback) => {
      const wl = record(raw.workLocation);
      const loc = text(wl.label);
      const f = standardExtract(raw, fallback);
      return { ...f, location: loc || f.location, isRemote: wl.isRemote === true || f.isRemote };
    },
  },
  {
    provider: 'comeet',
    name: 'Comeet',
    endpoint: (b) => {
      const [uid, tok] = splitBoard(b);
      return `https://www.comeet.co/careers-api/2.0/company/${uid}/positions?token=${tok}&details=true`;
    },
    boardUrl: (b) => `https://www.comeet.com/jobs/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 1: Comeet careers-api 2.0 positions JSON',
    items: arrRoot,
    extract: (raw, _b, fallback) => {
      const f = standardExtract(raw, fallback);
      const details = asArray(raw.details)?.map((d) => text(record(d).value)).filter(Boolean).join('\n\n');
      return { ...f, description: htmlToFeedText(details || f.description || '') || f.title };
    },
  },
  {
    provider: 'hibob',
    name: 'HiBob',
    endpoint: (b) => `https://${b}.careers.hibob.com/api/postings`,
    boardUrl: (b) => `https://${b}.careers.hibob.com/jobs`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 1: HiBob public postings feed',
    items: (p) => arrAt(p, 'postings'),
  },
  {
    provider: 'gem',
    name: 'Gem',
    endpoint: (b) => `https://api.gem.com/job_board/v0/${b}/jobs`,
    boardUrl: (b) => `https://jobs.gem.com/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 1: Gem public job_board v0 API',
    items: arrJobs,
  },
  {
    provider: 'manatal',
    name: 'Manatal',
    endpoint: (b) => `https://api.manatal.com/open/v3/career-page/${b}/jobs/`,
    boardUrl: (b) => `https://careers.manatal.com/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 1: Manatal open v3 career-page API',
    items: arrResults,
  },
  {
    provider: 'deel',
    name: 'Deel',
    endpoint: (b) => `https://jobs.deel.com/api/boards/${b}/jobs`,
    boardUrl: (b) => `https://jobs.deel.com/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 1: Deel job boards API',
    items: arrData,
  },
  // Wave 2 (18)
  {
    provider: 'careerplug',
    name: 'CareerPlug',
    endpoint: (b) => `https://${b}.careerplug.com/jobs.json`,
    boardUrl: (b) => `https://${b}.careerplug.com/jobs`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: CareerPlug public jobs.json',
    items: arrJobs,
  },
  {
    provider: 'apploi',
    name: 'Apploi',
    endpoint: (b) => `https://api.apploi.com/v1/companies/${b}/jobs`,
    boardUrl: (b) => `https://jobs.apploi.com/company/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Apploi public company jobs API',
    items: arrJobs,
  },
  {
    provider: 'ukg',
    name: 'UKG Pro Recruiting',
    endpoint: (b) => {
      const [h, t, id] = splitBoard(b);
      return `https://${h}/${t}/JobBoard/${id}/JobBoardView/LoadSearchResults`;
    },
    boardUrl: (b) => {
      const [h, t, id] = splitBoard(b);
      return `https://${h}/${t}/JobBoard/${id}`;
    },
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: UKG Pro LoadSearchResults JSON',
    items: (p) => arrAt(p, 'opportunities'),
    extract: (raw, _b, fallback) => {
      const locs = asArray(raw.Locations)?.map((l) => text(record(l).LocalizedName)).filter(Boolean).join(', ');
      const f = standardExtract(raw, fallback);
      return { ...f, location: locs || f.location };
    },
  },
  {
    provider: 'ukgready',
    name: 'UKG Ready',
    endpoint: (b) => {
      const [h, id] = splitBoard(b);
      return `https://secure.${h}/ta/rest/ui/recruitment/companies/${id}/jobs`;
    },
    boardUrl: (b) => {
      const [h, id] = splitBoard(b);
      return `https://secure.${h}/ta/${id}.careers`;
    },
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: UKG Ready public recruitment feed',
    items: arrJobs,
  },
  {
    provider: 'hireology',
    name: 'Hireology',
    endpoint: (b) => `https://api.hireology.com/v2/companies/${b}/jobs`,
    boardUrl: (b) => `https://careers.hireology.com/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Hireology public v2 jobs feed',
    items: arrData,
  },
  {
    provider: 'isolvedhire',
    name: 'iSolved Hire',
    endpoint: (b) => `https://${b}.isolvedhire.com/jobs.json`,
    boardUrl: (b) => `https://${b}.isolvedhire.com/jobs/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: iSolved Hire public jobs.json',
    items: arrJobs,
  },
  {
    provider: 'dayforce',
    name: 'Dayforce HCM',
    endpoint: (b) => `https://jobs.dayforcehcm.com/api/candidates/${b}/jobs`,
    boardUrl: (b) => `https://jobs.dayforcehcm.com/en-US/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Dayforce public candidate jobs API',
    items: (p) => arrAt(p, 'Data'),
  },
  {
    provider: 'adp',
    name: 'ADP Workforce Now',
    endpoint: (b) => {
      const [cid, ccid] = splitBoard(b, ':');
      return `https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=${cid}&ccId=${ccid}`;
    },
    boardUrl: (b) => `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${splitBoard(b, ':')[0]}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: ADP public job-requisitions endpoint',
    items: (p) => arrAt(p, 'jobRequisitions'),
    extract: (raw, _b, fallback) => {
      const locs = asArray(raw.requisitionLocations)
        ?.map((l) => text(record(record(l).nameCode).shortName))
        .filter(Boolean)
        .join(', ');
      const f = standardExtract(raw, fallback);
      return { ...f, location: locs || f.location };
    },
  },
  {
    provider: 'applicantpro',
    name: 'ApplicantPro',
    endpoint: (b) => `https://${b}.applicantpro.com/jobs/api/`,
    boardUrl: (b) => `https://${b}.applicantpro.com/jobs/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: ApplicantPro public jobs API',
    items: arrJobs,
  },
  {
    provider: 'zohorecruit',
    name: 'Zoho Recruit',
    endpoint: (b) => `https://${b}/recruit/v2/public/Job_Openings`,
    boardUrl: (b) => `https://${b}/jobs/Careers`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Zoho Recruit public Job_Openings feed',
    items: arrData,
  },
  {
    provider: 'paycor',
    name: 'Paycor Recruiting',
    endpoint: (b) => `https://recruitingbypaycor.com/career/PublicCareerSiteJobs.action?clientId=${b}`,
    boardUrl: (b) => `https://recruitingbypaycor.com/career/CareerHome.action?clientId=${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Paycor Recruiting career site feed',
    items: arrJobs,
  },
  {
    provider: 'betterteam',
    name: 'Betterteam',
    endpoint: (b) => `https://${b}.betterteam.com/api/jobs`,
    boardUrl: (b) => `https://${b}.betterteam.com/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Betterteam hosted careers API',
    items: arrJobs,
  },
  {
    provider: 'gupy',
    name: 'Gupy',
    endpoint: (b) => `https://portal.api.gupy.io/api/job?companyId=${b}`,
    boardUrl: (b) => `https://portal.gupy.io/company/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Gupy public portal API',
    items: arrData,
  },
  {
    provider: 'hiringthing',
    name: 'HiringThing / PrismHR',
    endpoint: (b) => `https://${b}/api/v1/jobs.json`,
    boardUrl: (b) => `https://${b}/jobs`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: HiringThing public jobs.json',
    items: arrJobs,
  },
  {
    provider: 'solides',
    name: 'Solides Vagas',
    endpoint: (b) => `https://apiv3.solides.com/jobs/${b}`,
    boardUrl: (b) => `https://${b}.vagas.solides.com.br/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Solides public jobs API',
    items: arrData,
  },
  {
    provider: 'factorial',
    name: 'Factorial HR',
    endpoint: (b) => `https://${b}/api/v1/job_postings`,
    boardUrl: (b) => `https://${b}/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Factorial HR public job_postings feed',
    items: arrData,
  },
  {
    provider: 'hrmdirect',
    name: 'ClearCompany / HRMDirect',
    endpoint: (b) => `https://${b}.hrmdirect.com/employment/job-openings.php?format=json`,
    boardUrl: (b) => `https://${b}.hrmdirect.com/employment/job-openings.php`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: HRMDirect JSON feed',
    items: arrJobs,
  },
  {
    provider: 'gusto',
    name: 'Gusto Jobs',
    endpoint: (b) => `https://jobs.gusto.com/api/boards/${b}/postings`,
    boardUrl: (b) => `https://jobs.gusto.com/boards/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 2: Gusto public job boards feed',
    items: arrJobs,
  },
  // Wave 3 (14)
  {
    provider: 'taleo',
    name: 'Oracle Taleo',
    endpoint: (b) => {
      const [h, cs] = splitBoard(b);
      return `https://${h}/careersection/rest/jobboard/searchjobs?lang=en&portal=${cs || '1'}`;
    },
    boardUrl: (b) => {
      const [h, cs] = splitBoard(b);
      return `https://${h}/careersection/${cs || '1'}/jobsearch.ftl`;
    },
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: Taleo public careersection REST feed',
    items: (p) => arrAt(p, 'requisitionList'),
  },
  {
    provider: 'eightfold',
    name: 'Eightfold.ai',
    endpoint: (b) => {
      const [h, domain] = splitBoard(b);
      return `https://${h}/api/apply/v2/jobs?domain=${encodeURIComponent(domain || h)}`;
    },
    boardUrl: (b) => `https://${splitBoard(b)[0]}/careers`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: Eightfold apply v2 public jobs feed',
    items: (p) => arrAt(p, 'data', 'positions'),
  },
  {
    provider: 'huntflow',
    name: 'Huntflow',
    endpoint: (b) => `https://${b}.huntflow.io/api/public/vacancies`,
    boardUrl: (b) => `https://${b}.huntflow.io/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: Huntflow public career page API',
    items: (p) => arrAt(p, 'items'),
  },
  {
    provider: 'avature',
    name: 'Avature',
    endpoint: (b) => `https://${b}/en_US/careers/SearchJobs/feed`,
    boardUrl: (b) => `https://${b}/en_US/careers`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: Avature public career feed',
    items: arrJobs,
  },
  {
    provider: 'cornerstone',
    name: 'Cornerstone OnDemand',
    endpoint: (b) => `https://${b}.csod.com/services/api/Recruiting/CareerSite/Search`,
    boardUrl: (b) => `https://${b}.csod.com/ux/ats/careersite/1/home`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: Cornerstone public career site API',
    items: arrJobs,
  },
  {
    provider: 'pageup',
    name: 'PageUp People',
    endpoint: (b) => `https://careers.pageuppeople.com/api/${b}/jobs`,
    boardUrl: (b) => `https://careers.pageuppeople.com/${b}/cw/en/listing/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: PageUp People public job board feed',
    items: arrJobs,
  },
  {
    provider: 'workstream',
    name: 'Workstream',
    endpoint: (b) => `https://api.workstream.us/api/v1/companies/${b}/jobs`,
    boardUrl: (b) => `https://apply.workstream.us/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: Workstream public jobs API',
    items: arrData,
  },
  {
    provider: 'freshteam',
    name: 'Freshteam',
    endpoint: (b) => `https://${b}.freshteam.com/api/job_postings`,
    boardUrl: (b) => `https://${b}.freshteam.com/jobs`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: Freshteam public job_postings feed',
    items: arrRoot,
  },
  {
    provider: 'applitrack',
    name: 'AppliTrack',
    endpoint: (b) => `https://www.applitrack.com/${b}/onlineapp/api/jobs`,
    boardUrl: (b) => `https://www.applitrack.com/${b}/onlineapp/default.aspx`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: AppliTrack public district job board feed',
    items: arrJobs,
  },
  {
    provider: 'trakstar',
    name: 'Trakstar Hire',
    endpoint: (b) => `https://${b}.hire.trakstar.com/api/v1/jobs`,
    boardUrl: (b) => `https://${b}.hire.trakstar.com/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: Trakstar Hire public jobs JSON',
    items: arrJobs,
  },
  {
    provider: 'inhire',
    name: 'InHire',
    endpoint: (b) => `https://${b}.inhire.app/api/jobs`,
    boardUrl: (b) => `https://${b}.inhire.app/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: InHire public jobsPage feed',
    items: (p) => arrAt(p, 'jobsPage'),
  },
  {
    provider: 'talentlyft',
    name: 'TalentLyft',
    endpoint: (b) => `https://${b}.talentlyft.com/api/v2/jobs`,
    boardUrl: (b) => `https://${b}.talentlyft.com/`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: TalentLyft public v2 jobs feed',
    items: arrResults,
  },
  {
    provider: 'jobscore',
    name: 'JobScore',
    endpoint: (b) => `https://careers.jobscore.com/careers/${b}/jobs.json`,
    boardUrl: (b) => `https://careers.jobscore.com/careers/${b}`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: JobScore public jobs.json feed',
    items: arrJobs,
  },
  {
    provider: 'peopleforce',
    name: 'PeopleForce',
    endpoint: (b) => `https://${b}.peopleforce.io/api/public/v1/vacancies`,
    boardUrl: (b) => `https://${b}.peopleforce.io/careers`,
    measuredAt: '2026-11-24',
    robotsNote: 'Wave 3: PeopleForce public vacancies feed',
    items: arrData,
  },
];

const WAVE_SPEC_MAP = new Map<string, WaveAtsSpec>(WAVE_ATS_SPECS.map((s) => [s.provider, s]));

export function readWaveAtsBoard(
  provider: WaveAtsProvider,
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
  board: string,
): UnifiedVacancy[] {
  const spec = WAVE_SPEC_MAP.get(provider);
  if (!spec) throw new Error(UNREADABLE);
  const items = spec.items(payload);
  if (!items) throw new Error(UNREADABLE);
  const companyFallback = context.sourceName?.trim() || board;
  return items
    .map((item) => {
      const raw = record(item);
      const fields = spec.extract ? spec.extract(raw, board, companyFallback) : standardExtract(raw, companyFallback);
      return buildJsonVacancy({
        sourceId,
        context,
        externalId: fields.externalId,
        title: fields.title,
        company: fields.company || companyFallback,
        location: fields.location,
        isRemote: Boolean(fields.isRemote),
        description: fields.description || fields.title,
        skills: [],
        employmentType: fields.employmentType,
        url: fields.url,
        publishedAt: fields.publishedAt || context.observedAt,
      });
    })
    .filter(isUsableVacancy);
}

export function countWaveAtsJobs(provider: string, body: string): number {
  const spec = WAVE_SPEC_MAP.get(provider);
  if (!spec) return -1;
  try {
    const parsed: unknown = JSON.parse(body);
    const items = spec.items(parsed);
    return items ? items.length : -1;
  } catch {
    return -1;
  }
}
