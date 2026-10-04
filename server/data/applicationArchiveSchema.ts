/** B363 — archive reason and previous stage, appended without rebuilding applications. */
export const MIGRATION_38 = `
ALTER TABLE applications ADD COLUMN archive_reason TEXT DEFAULT NULL;
ALTER TABLE applications ADD COLUMN archive_previous_stage TEXT DEFAULT NULL;
`;
