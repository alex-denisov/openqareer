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
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

export const LINKEDIN_GUEST_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
