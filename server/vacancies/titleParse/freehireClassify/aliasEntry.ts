/** One alias → canonical pair; '-' is freehire's categoryNone sentinel (a blind alias). */
export type AliasEntry = readonly [alias: string, canonical: string];

export const CATEGORY_NONE = '-';
