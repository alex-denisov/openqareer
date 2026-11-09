/** Распознавание ATS, встроенной в страницу вакансий компании (вынесено из genericCorporateSiteAdapter, B628). */
export type DetectedAtsProvider =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'workable'
  | 'smartrecruiters'
  | 'recruitee'
  | 'dou';

export interface DetectedAts {
  readonly provider: DetectedAtsProvider;
  readonly endpointUrl: string;
  readonly orgId?: string;
}

const ATS_MATCHERS: Array<(text: string) => DetectedAts | null> = [
  (text) => {
    const m = text.match(/https?:\/\/([a-z0-9_-]+\.wd\d+\.myworkdayjobs\.com)\/([a-z0-9_-]+)/i);
    if (!m) return null;
    const [host, site] = [m[1], m[2]];
    const tenant = host.split('.')[0];
    return {
      provider: 'workday',
      endpointUrl: `https://${host}/wday/cxs/${tenant}/${site}/jobs`,
      orgId: `${tenant}/${site}`,
    };
  },
  (text) => {
    // B628: embed ?for=slug и boards-api; служебные слова — только целиком.
    const embed = text.match(/greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/i);
    const api = text.match(/boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i);
    const page = text.match(
      /(?:boards\.greenhouse\.io|job-boards\.greenhouse\.io|job-boards\.eu\.greenhouse\.io)\/([a-z0-9_-]+)/i,
    );
    const slug = embed?.[1] ?? api?.[1] ?? page?.[1];
    if (!slug || /^(?:embed|api|v1)$/i.test(slug)) return null;
    return {
      provider: 'greenhouse',
      endpointUrl: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
      orgId: slug,
    };
  },
  (text) => {
    const m = text.match(
      /(?:jobs\.ashbyhq\.com\/|api\.ashbyhq\.com\/posting-api\/job-board\/)([a-z0-9_.-]+)/i,
    );
    if (!m?.[1]) return null;
    return {
      provider: 'ashby',
      endpointUrl: `https://api.ashbyhq.com/posting-api/job-board/${m[1]}`,
      orgId: m[1],
    };
  },
  (text) => {
    const m = text.match(/(?:jobs\.lever\.co|jobs\.eu\.lever\.co)\/([a-z0-9_-]+)/i);
    if (!m?.[1]) return null;
    const isEu = /jobs\.eu\.lever\.co/i.test(text);
    return {
      provider: 'lever',
      endpointUrl: isEu
        ? `https://api.eu.lever.co/v0/postings/${m[1]}?mode=json`
        : `https://api.lever.co/v0/postings/${m[1]}?mode=json`,
      orgId: m[1],
    };
  },
  (text) => {
    const service = /^(?:api|j|widget|assets|www|apply|jobs|careers)$/i;
    const page = text.match(/apply\.workable\.com\/(?:[a-z]{2}\/)?([a-z0-9_-]+)/i);
    const sub = text.match(/\b([a-z0-9-]+)\.workable\.com/i);
    const slug = [page?.[1], sub?.[1]].find((s) => s && !service.test(s));
    if (!slug) return null;
    return {
      provider: 'workable',
      endpointUrl: `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`,
      orgId: slug,
    };
  },
  (text) => {
    const m = text.match(/jobs\.smartrecruiters\.com\/([a-z0-9_-]+)/i);
    if (!m?.[1]) return null;
    return {
      provider: 'smartrecruiters',
      endpointUrl: `https://api.smartrecruiters.com/v1/companies/${m[1]}/postings`,
      orgId: m[1],
    };
  },
  (text) => {
    const m = text.match(/(?:([a-z0-9_-]+)\.recruitee\.com|recruitee\.com\/([a-z0-9_-]+))/i);
    const slug = m?.[1] || m?.[2];
    if (!slug || /^(?:api|assets|static|blog|www|careers)$/i.test(slug)) return null;
    return {
      provider: 'recruitee',
      endpointUrl: `https://${slug}.recruitee.com/api/offers/`,
      orgId: slug,
    };
  },
  (text) => {
    const m = text.match(/jobs\.dou\.ua\/companies\/([a-z0-9_-]+)\/vacancies/i);
    if (!m?.[1]) return null;
    return {
      provider: 'dou',
      endpointUrl: `https://jobs.dou.ua/companies/${m[1]}/vacancies/`,
      orgId: m[1],
    };
  },
];

/**
 * Стратегия 4: Обнаружение встроенных ATS в адресе страницы или внутри HTML.
 */
export function detectEmbeddedAts(textToScan: string): DetectedAts | null {
  if (!textToScan || typeof textToScan !== 'string') return null;
  for (const matcher of ATS_MATCHERS) {
    const match = matcher(textToScan);
    if (match) return match;
  }
  return null;
}
