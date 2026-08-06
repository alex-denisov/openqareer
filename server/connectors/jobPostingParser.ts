import { z } from 'zod';

const MAX_HTML_BYTES = 1_000_000;
const MAX_JSON_LD_NODES = 1_000;

const provenanceSchema = z.object({
  sourceId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  sourceUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://')),
  observedAt: z.string().datetime(),
});

interface ParserProvenanceInput {
  sourceId: string;
  sourceUrl: string;
  observedAt: string;
}

export interface ParsedJobPosting {
  nativeId: string | null;
  title: string;
  company: string | null;
  location: { city?: string; country?: string } | null;
  employmentTypes: string[];
  canonicalUrl: string;
  publishedAt: string | null;
  provenance: {
    sourceId: string;
    sourceUrl: string;
    observedAt: string;
    transport: 'public_http_parser';
  };
}

export function parseJobPostingJsonLd(
  html: string,
  provenanceInput: ParserProvenanceInput,
): ParsedJobPosting[] {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('job_source_html_too_large');
  }
  const provenanceResult = provenanceSchema.safeParse(provenanceInput);
  if (!provenanceResult.success) {
    throw new Error('job_source_url_invalid');
  }
  const provenance = provenanceResult.data;
  const postings: ParsedJobPosting[] = [];
  const seen = new Set<string>();
  const scriptPattern =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

  for (const match of html.matchAll(scriptPattern)) {
    const payload = parseJson(match[1] ?? '');
    if (payload === null) continue;
    for (const node of flattenJsonLd(payload)) {
      const posting = normalizeJobPosting(node, provenance);
      if (!posting) continue;
      const key = `${posting.nativeId ?? ''}|${posting.canonicalUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      postings.push(posting);
    }
  }

  return postings;
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    visited += 1;
    if (visited > MAX_JSON_LD_NODES) {
      throw new Error('job_source_jsonld_too_complex');
    }
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }
    if (!isRecord(current)) continue;
    records.push(current);
    if (current['@graph'] !== undefined) pending.push(current['@graph']);
  }
  return records;
}

function normalizeJobPosting(
  node: Record<string, unknown>,
  provenance: z.infer<typeof provenanceSchema>,
): ParsedJobPosting | null {
  if (!hasType(node['@type'], 'JobPosting')) return null;
  const title = boundedString(node.title, 500);
  if (!title) return null;
  const canonicalUrl = safeHttpUrl(node.url) ?? provenance.sourceUrl;
  const organization = isRecord(node.hiringOrganization)
    ? node.hiringOrganization
    : null;
  const identifier = isRecord(node.identifier) ? node.identifier.value : node.identifier;
  const locationNode = Array.isArray(node.jobLocation)
    ? node.jobLocation.find(isRecord)
    : node.jobLocation;
  const address = isRecord(locationNode) && isRecord(locationNode.address)
    ? locationNode.address
    : null;
  const city = address ? boundedString(address.addressLocality, 200) : null;
  const country = address ? countryCode(address.addressCountry) : null;

  return {
    nativeId: boundedString(identifier, 200),
    title,
    company: organization ? boundedString(organization.name, 300) : null,
    location: city || country
      ? {
          ...(city ? { city } : {}),
          ...(country ? { country } : {}),
        }
      : null,
    employmentTypes: stringArray(node.employmentType, 20, 100),
    canonicalUrl,
    publishedAt: boundedString(node.datePosted, 50),
    provenance: {
      ...provenance,
      transport: 'public_http_parser',
    },
  };
}

function hasType(value: unknown, expected: string): boolean {
  return typeof value === 'string'
    ? value === expected
    : Array.isArray(value) && value.includes(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function countryCode(value: unknown): string | null {
  if (typeof value === 'string') return boundedString(value, 100);
  if (!isRecord(value)) return null;
  return boundedString(value.name, 100);
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => boundedString(item, maxLength))
    .filter((item): item is string => item !== null)
    .slice(0, maxItems);
}
