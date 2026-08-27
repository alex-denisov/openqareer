/** Stored documents are capped by the database itself: byte_size <= 5242880. */
export const DOCUMENT_MAX_BYTES = 5 * 1_024 * 1_024;

/** A PDF read in the browser is never stored, so it may be larger. */
export const LOCAL_PDF_MAX_BYTES = 20 * 1_024 * 1_024;

export function megabytes(bytes: number): number {
  return Math.round(bytes / (1_024 * 1_024));
}
