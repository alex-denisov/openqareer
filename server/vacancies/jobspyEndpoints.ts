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

export function indeedHeaders(): Record<string, string> {
  return {
    Host: 'apis.indeed.com',
    'content-type': 'application/json',
    'indeed-api-key': INDEED_API_KEY,
    accept: 'application/json',
    'indeed-locale': 'en-US',
    'indeed-co': 'US',
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Indeed App 193.1',
    'indeed-app-info': 'appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone',
  };
}

/** Форма запроса приложения Indeed (проверена JobSpy). 100 записей на страницу. */
export function indeedQuery(what: string, cursor: string | null): string {
  const cursorLine = cursor ? `cursor: "${cursor}"` : '';
  return `query GetJobData {
    jobSearch(
      what: "${what}"
      location: { where: "United States", radius: 50, radiusUnit: MILES }
      limit: 100
      ${cursorLine}
      sort: RELEVANCE
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

export const LINKEDIN_GUEST_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
