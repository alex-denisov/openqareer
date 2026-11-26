/**
 * 11.11: the Indexing API is off by default. Our project is Owner of the GSC
 * property and publish answers 200, but the reply carries no `latestUpdate` and
 * `urlNotifications/metadata` answers 404 for every URL we sent (checked by hand
 * the same day): Google accepts the call and records nothing, which is what an
 * unapproved project gets. Re-enable with OPENQAREER_GOOGLE_INDEXING_ENABLED=1
 * once Google approves the project and metadata shows a sent URL.
 */
export function googleIndexingKey(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return env.OPENQAREER_GOOGLE_INDEXING_ENABLED === '1'
    ? env.OPENQAREER_GSC_SERVICE_ACCOUNT_B64
    : undefined;
}
