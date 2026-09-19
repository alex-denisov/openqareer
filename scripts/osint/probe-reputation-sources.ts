#!/usr/bin/env node
import { retrieveReputationSourceReceipt } from '../../server/osint/reputationSourceReceipt';

const candidateId = process.argv[2] ?? 'candidate-public-test';
const sources = [
  ['telegram', 'https://t.me/alexey_denisov'],
  ['linkedin', 'https://www.linkedin.com/in/alexeydenisov/'],
  ['instagram', 'https://www.instagram.com/alexey_s_denisov/'],
  ['facebook', 'https://www.facebook.com/alexey.denisov'],
] as const;

const receipts = await Promise.all(
  sources.map(([platform, sourceUrl]) =>
    retrieveReputationSourceReceipt({ candidateId, platform, sourceUrl }),
  ),
);

for (const receipt of receipts) {
  console.log(
    JSON.stringify({
      platform: receipt.platform,
      status: receipt.status,
      coverage: receipt.coverage,
      httpStatus: receipt.httpStatus ?? null,
      contentBytes: receipt.contentBytes ?? null,
      contentType: receipt.contentType ?? null,
      observedAt: receipt.observedAt,
      hasContentHash: Boolean(receipt.contentSha256),
      identityBinding: receipt.identityBinding,
      diagnostic: receipt.diagnostic ?? null,
    }),
  );
}
