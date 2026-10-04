import { createHash } from 'node:crypto';
import type { CandidateFootprintFinding, FootprintReview } from '../../shared/candidateFootprint';
import type { FootprintFinding, FootprintMatch } from './adapters/footprintAdapter';

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return value;
  }
}

function findingKey(finding: Pick<FootprintFinding, 'adapter' | 'kind' | 'url' | 'title'>): string {
  if (finding.url) return `url:${canonicalUrl(finding.url)}`;
  return `value:${finding.adapter}:${finding.kind}:${finding.title.trim().toLocaleLowerCase('ru-RU')}`;
}

function stableFindingId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}

function receiptList(finding: CandidateFootprintFinding): readonly FootprintFinding['receipt'][] {
  return finding.receipts?.length ? finding.receipts : [finding.receipt];
}

function uniqueReceipts(
  receipts: readonly FootprintFinding['receipt'][],
): readonly FootprintFinding['receipt'][] {
  const unique = new Map<string, FootprintFinding['receipt']>();
  for (const receipt of receipts) {
    unique.set(`${receipt.method}\0${receipt.source}\0${receipt.query}`, receipt);
  }
  return [...unique.values()];
}

function uniqueSources(sources: readonly string[]): readonly string[] {
  return [...new Set(sources)];
}

function automaticMatch(match: FootprintMatch): 'likely_self' | 'unknown' {
  return match === 'likely_self' ? 'likely_self' : 'unknown';
}

function strongerMatch(
  left: 'likely_self' | 'unknown',
  right: FootprintMatch,
): 'likely_self' | 'unknown' {
  if (left === 'likely_self' || right === 'likely_self') return 'likely_self';
  return 'unknown';
}

function reviewMatch(
  review: FootprintReview,
  match: 'likely_self' | 'unknown',
): FootprintMatch {
  if (review === 'confirmed_self') return 'confirmed_self';
  if (review === 'not_self') return 'not_self';
  return match;
}

function previousFinding(finding: CandidateFootprintFinding): CandidateFootprintFinding {
  const base = (finding as CandidateFootprintFinding & { automatedMatch?: 'likely_self' | 'unknown' })
    .automatedMatch ?? automaticMatch(finding.match);
  return {
    ...finding,
    url: finding.url ? canonicalUrl(finding.url) : null,
    sources: uniqueSources(finding.sources?.length ? finding.sources : [finding.adapter]),
    receipts: uniqueReceipts(receiptList(finding)),
    automatedMatch: base,
    match: reviewMatch(finding.review, base),
  };
}

function withCandidateFields(
  finding: FootprintFinding,
  review: FootprintReview,
  id = stableFindingId(findingKey(finding)),
): CandidateFootprintFinding {
  const base = automaticMatch(finding.match);
  return {
    ...finding,
    url: finding.url ? canonicalUrl(finding.url) : null,
    id,
    sources: [finding.adapter],
    receipts: [finding.receipt],
    automatedMatch: base,
    review,
    match: reviewMatch(review, base),
  };
}

function mergeFinding(
  existing: CandidateFootprintFinding,
  incoming: FootprintFinding,
): CandidateFootprintFinding {
  const base = strongerMatch(existing.automatedMatch, incoming.match);
  return {
    ...incoming,
    url: incoming.url ? canonicalUrl(incoming.url) : null,
    id: existing.id,
    review: existing.review,
    sources: uniqueSources([...existing.sources, incoming.adapter]),
    receipts: uniqueReceipts([...receiptList(existing), incoming.receipt]),
    automatedMatch: base,
    match: reviewMatch(existing.review, base),
  };
}

export function mergeFootprintFindings(
  currentFindings: readonly FootprintFinding[],
  previousFindings: readonly CandidateFootprintFinding[],
): readonly CandidateFootprintFinding[] {
  const merged = new Map<string, CandidateFootprintFinding>();
  for (const finding of previousFindings) {
    merged.set(findingKey(finding), previousFinding(finding));
  }
  for (const finding of currentFindings) {
    const key = findingKey(finding);
    const previous = merged.get(key);
    merged.set(key, previous ? mergeFinding(previous, finding) : withCandidateFields(finding, 'unreviewed'));
  }
  return [...merged.values()];
}
