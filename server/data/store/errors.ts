export class CandidateNotFoundError extends Error {}
export class CandidateStoreConflictError extends Error {}
export class CandidateDocumentRetentionError extends Error {}
export class CandidateDocumentNotFoundError extends Error {}
/** B251 — PATCH /applications with a stale `expectedVersion` (architecture.md §4). */
export class ApplicationVersionConflictError extends Error {}
export class ApplicationNotFoundError extends Error {}
