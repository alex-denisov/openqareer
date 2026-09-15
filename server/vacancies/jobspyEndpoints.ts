import { getRandomizedUserAgent } from '../crawler/obscuraStealth';

/**
 * Общие данные площадок, снятых по механике JobSpy (B218). Отдельный файл,
 * потому что это факты о чужих адресах (ключ приложения Indeed, форма запроса),
 * а не логика продукта. Ключ Indeed — публичный ключ их же мобильного
 * приложения: он едет в каждом запросе iOS-клиента и не является секретом
 * продукта. Мы ходим тем же адресом, что и приложение, без учётной записи.
 */

/** Ключ мобильного приложения Indeed — публичный, снят из клиента (JobSpy). */
export const INDEED_API_KEY = '161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8';

export const INDEED_GRAPHQL_URL = 'https://apis.indeed.com/graphql';

/**
 * Код страны едет заголовком `indeed-co` и обязан быть заглавным: на строчный
 * площадка отвечает «Request country us does not correspond to a valid Indeed
 * country» (замер 2026-09-14).
 */
export function indeedHeaders(country = 'US'): Record<string, string> {
  return {
    Host: 'apis.indeed.com',
    'content-type': 'application/json',
    'indeed-api-key': INDEED_API_KEY,
    accept: 'application/json',
    'indeed-locale': 'en-US',
    'indeed-co': country.toUpperCase(),
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Indeed App 193.1',
    'indeed-app-info': 'appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone',
  };
}

/**
 * Форма запроса приложения Indeed (проверена JobSpy). 100 записей на страницу,
 * не больше 968 на один запрос — дальше курсора нет (замер 2026-09-14).
 *
 * `sort: DATE`, а не RELEVANCE: по релевантности выдача мешает свежее со
 * старым (в замере — до 2021 года), и фильтр свежести пула отбрасывал больше
 * половины прочитанного. По дате первая же страница — свежайшее.
 */
export function indeedQuery(what: string, cursor: string | null, where = 'United States'): string {
  const cursorLine = cursor ? `cursor: "${cursor}"` : '';
  return `query GetJobData {
    jobSearch(
      what: "${escapeGraphqlString(what)}"
      location: { where: "${escapeGraphqlString(where)}", radius: 50, radiusUnit: MILES }
      limit: 100
      ${cursorLine}
      sort: DATE
    ) {
      pageInfo { nextCursor }
      results {
        job {
          source { name }
          key
          title
          datePublished
          dateOnIndeed
          description { html }
          location { countryName admin1Code city formatted { long } }
          compensation { baseSalary { unitOfWork range { ... on Range { min max } } } currencyCode }
          employer { relativeCompanyPageUrl name }
          recruit { viewJobUrl }
        }
      }
    }
  }`;
}

/** Значение едет внутрь строки GraphQL — кавычки и обратный слэш экранируются. */
function escapeGraphqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ');
}

export const LINKEDIN_GUEST_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

/** Naukri API endpoint (механика JobSpy, v3 search API). */
export const NAUKRI_SEARCH_URL = 'https://www.naukri.com/jobapi/v3/search';

export function naukriHeaders(): Record<string, string> {
  return {
    appid: '109',
    systemid: 'Naukri',
    clientid: '109',
    Nkparam:
      'Ppy0YK9uSHqPtG3bEejYc04RTpUN2CjJOrqA68tzQt0SKJHXZKzz9M8cZtKLVkoOuQmfe4cTb1r2CwfHaxW5Tg==',
    accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
}

export function naukriQueryParams(keyword: string, pageNo = 1): Record<string, string> {
  return {
    keyword,
    pageNo: String(pageNo),
    sort: 'date',
    noOfResults: '20',
  };
}

/** BDJobs API gateway endpoint (механика JobSpy). */
export const BDJOBS_SEARCH_URL = 'https://gateway.bdjobs.com/v1/api/jobsearch';

export function bdjobsHeaders(): Record<string, string> {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json, text/html, */*',
  };
}

export function bdjobsPayload(keyword: string, pg = 1): Record<string, string> {
  return {
    hidJobSearch: 'jobsearch',
    txtKeyword: keyword,
    pg: String(pg),
  };
}

/** ZipRecruiter mobile iOS API endpoint (механика JobSpy). */
export const ZIPRECRUITER_JOBS_URL = 'https://api.ziprecruiter.com/jobs-app/jobs';
export const ZIPRECRUITER_AUTH_TOKEN = 'Basic YTBlZjMyZDYtN2I0Yy00MWVkLWEyODMtYTI1NDAzMzI0YTcyOg==';

export function ziprecruiterHeaders(): Record<string, string> {
  return {
    authorization: ZIPRECRUITER_AUTH_TOKEN,
    'x-zr-zapi-version': '8',
    'User-Agent': 'Job Search/87.0 (iPhone; CPU iOS 16_6_1 like Mac OS X)',
    accept: 'application/json',
  };
}

export function ziprecruiterQueryParams(
  search: string,
  location = 'United States',
  page = 1,
  perPage = 50,
): Record<string, string> {
  return {
    search,
    location,
    page: String(page),
    per_page: String(perPage),
  };
}

/** Glassdoor GraphQL endpoint (JobSpy GraphQL BFF mechanics). */
export const GLASSDOOR_GRAPHQL_URL = 'https://www.glassdoor.com/graph';

export function glassdoorHeaders(csrfToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': getRandomizedUserAgent(),
    'Content-Type': 'application/json',
    accept: '*/*',
    'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
  if (csrfToken) {
    headers['gd-csrf-token'] = csrfToken;
  }
  return headers;
}

export function glassdoorPayload(
  keyword: string,
  location = 'United States',
  page = 1,
  numJobs = 30,
): { operationName: string; variables: Record<string, unknown>; query: string } {
  return {
    operationName: 'JobSearchResultsQuery',
    variables: {
      keyword,
      location,
      locationId: 1,
      locationType: 'N',
      numJobsToShow: numJobs,
      pageNumber: page,
      parameterUrlEncoded: true,
    },
    query: `query JobSearchResultsQuery($keyword: String, $location: String, $locationId: Int, $locationType: String, $numJobsToShow: Int, $pageNumber: Int) {
      jobListings(keyword: $keyword, location: $location, locationId: $locationId, locationType: $locationType, numJobsToShow: $numJobsToShow, pageNumber: $pageNumber) {
        jobview {
          header {
            jobTitleText
            employerNameFromSearch
            locationName
            salary {
              min
              max
              currency
            }
          }
          job {
            listingId
            description
            datePosted
          }
          overview {
            name
            shortName
          }
        }
      }
    }`,
  };
}

export function extractGlassdoorCsrfToken(
  htmlOrHeaders: string | Record<string, string>,
): string | undefined {
  if (typeof htmlOrHeaders === 'string') {
    const metaMatch = /<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i.exec(
      htmlOrHeaders,
    );
    if (metaMatch) return metaMatch[1];
    const jsMatch = /"csrfToken":\s*"([^"]+)"/i.exec(htmlOrHeaders);
    if (jsMatch) return jsMatch[1];
    return undefined;
  }

  if (htmlOrHeaders['gd-csrf-token']) return htmlOrHeaders['gd-csrf-token'];
  const cookie = htmlOrHeaders['set-cookie'] || htmlOrHeaders.cookie;
  if (cookie) {
    const m = /gd-csrf-token=([^;]+)/i.exec(cookie);
    if (m) return m[1];
  }
  return undefined;
}

/** Bayt search URL & headers (Middle East / Gulf / International). */
export const BAYT_SEARCH_URL = 'https://www.bayt.com/en/international/jobs/';

export function baytHeaders(): Record<string, string> {
  return {
    'User-Agent': getRandomizedUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };
}

export function baytQueryParams(keyword: string, page = 1): Record<string, string> {
  return {
    q: keyword,
    page: String(page),
  };
}
