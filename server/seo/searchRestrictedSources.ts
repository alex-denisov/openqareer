/**
 * Sources whose terms forbid passing their jobs to Google (owner decision, 04.11).
 *
 * himalayas.app/terms#api: "Do not pass them on to third parties, such as other
 * job boards, aggregators, job search engines, Google Jobs or LinkedIn Jobs,
 * including through feeds or JobPosting structured data."
 *
 * Such a card keeps its page, its `index` and its sitemap line, but has no
 * JobPosting and is not sent to the Indexing API. One such source in a cluster is
 * enough: its fields are merged into the card and cannot be told apart there.
 */
export const SEARCH_RESTRICTED_SOURCE_IDS: readonly string[] = [
  'src-himalayas',
  'src-himalayas-api',
];

export function hasSearchRestrictedSource(
  sources: ReadonlyArray<{ readonly sourceId: string }>,
): boolean {
  return sources.some((source) => SEARCH_RESTRICTED_SOURCE_IDS.includes(source.sourceId));
}

/** How a source id looks inside `vacancy_clusters.cluster_json`, for a check in SQL. */
export const SEARCH_RESTRICTED_JSON_NEEDLES: readonly string[] = SEARCH_RESTRICTED_SOURCE_IDS.map(
  (id) => `"sourceId":"${id}"`,
);
