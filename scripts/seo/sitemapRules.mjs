/** The rules live in one TypeScript module, shared with the daily check on prod. */
export {
  checkUrl,
  extractLocs,
  isSitemapIndex,
  parseRobotsDisallow,
} from '../../server/seo/sitemapRules.ts';
