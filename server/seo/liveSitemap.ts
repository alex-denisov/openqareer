/**
 * 11.11: a job sitemap file is built every 30 minutes, and in between a card can
 * close (410) or get a new slug (canonical elsewhere). On every read the web
 * server re-checks each line against the live catalog: a closed card is dropped,
 * a moved one is written with its current path. The closed address itself keeps
 * answering 410, which is how Google drops it from the index.
 */
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import { parseVacancyPath } from '../../shared/vacancyCatalogRoutes';

/** Current public path for a card key, or undefined when the card is closed. */
export type LiveCardPath = (key: string) => string | undefined;

const URL_LINE = /^ {2}<url><loc>([^<]+)<\/loc>(.*)<\/url>$/u;

export function liveJobsXml(xml: string, livePath: LiveCardPath): string {
  return xml
    .split('\n')
    .flatMap((line) => {
      const match = URL_LINE.exec(line);
      if (!match) return [line];
      const path = match[1]!.replace(/&amp;/gu, '&').slice(SITE_ORIGIN.length);
      const key = parseVacancyPath(path);
      if (!key) return [line];
      const current = livePath(key);
      if (!current) return [];
      return current === path
        ? [line]
        : [`  <url><loc>${SITE_ORIGIN}${current}</loc>${match[2]}</url>`];
    })
    .join('\n');
}
