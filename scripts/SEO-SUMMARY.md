# Prepared SEO sources

The admin summary reads an optional prepared aggregate file. Opening the page never calls Google/Yandex or reads provider credentials. A missing configuration/file displays unavailable sources.

An operator collects observations with the existing Google/Yandex scripts, then exports a separate safe projection using the installed runtime:

```sh
node_modules/.bin/tsx scripts/export-seo-summary.ts \
  --output /absolute/private/prepared-seo.json \
  --google /absolute/private/google-observation.json \
  --yandex /absolute/private/yandex-observation.json
```

These are example paths. The output parent must already exist, be trusted and owned by the operator, and live outside Git/static delivery. Each input is a trusted operator-controlled collector observation with ISO `observedAt`. The weekly observation store adds that timestamp. Both provider flags are optional individually; at least one is required. A new failure preserves the previous last successful observation. Out-of-order observations and synthetic fixtures are rejected. Invalid input never replaces the existing output. Export is a private0600 atomic rename, with no network or remote upload.

The projection contains schemaVersion1, the exact OpenQareer origin, per-provider latestAttempt and lastSuccess, nullable actual metrics, actual source date window and at most50 query rows. It omits credential/token fields, provider host/user IDs, raw URL inspections and provider error bodies. Do not use it to publish raw observation archives.

Configure `OPENQAREER_SEO_SUMMARY_SNAPSHOT_FILE` to the absolute trusted server path only after the operator deliberately publishes the projection there. This feature does not configure credentials, copy local files to production or activate a schedule. The server caps the file at128KiB, rejects nonregular/symlink files and invalid schemas, and caches parsed content for10seconds. Failed/missing input has no external fallback.

The admin displays actual observation/window dates, unknown metrics as unavailable, and a prior successful observation after a failed attempt. A successful observation older than8days is marked stale. Google aggregate metrics are not derived by summing its popular-query rows; Yandex query rows are not presented as aggregate search clicks. Partial source availability remains explicit. Product-goal periods remain separate from provider periods; organic conversion is unavailable without real attribution.
