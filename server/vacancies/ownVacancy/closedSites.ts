/** B676: площадки, страницы которых не читаем (условия и robots.txt); кандидату предлагается вставить текст. */
const CLOSED_SITES = /(^|\.)(linkedin\.com|hh\.ru|headhunter\.ru|superjob\.ru|indeed\.com|indeed\.[a-z.]+)$/u;

export function isClosedSite(url: URL): boolean {
  return CLOSED_SITES.test(url.hostname.toLowerCase().replace(/\.$/u, ''));
}
