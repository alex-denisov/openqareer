#!/usr/bin/env node
import {
  createCandidateDeclaredIdentifierReceipt,
  retrieveReputationSourceReceipt,
} from '../../server/osint/reputationSourceReceipt';

const candidateId = process.argv[2] ?? 'candidate-public-test';
const sources = [
  ['telegram', 'https://t.me/alexey_denisov'],
  ['linkedin', 'https://www.linkedin.com/in/alexeydenisov/'],
  ['instagram', 'https://www.instagram.com/alexey_s_denisov/'],
  ['facebook', 'https://www.facebook.com/alexey.denisov'],
] as const;

const declaredIdentifiers = [
  ['email', '890525@gmail.com'],
  ['email', 'alexey.denisov@me.com'],
  ['email', 'alexey.s.denisov@yandex.ru'],
  ['phone', '+7 (965) 193-60-59'],
  ['profile_url', 'https://t.me/alexey_denisov'],
  ['profile_url', 'https://www.linkedin.com/in/alexeydenisov/'],
  ['profile_url', 'https://www.instagram.com/alexey_s_denisov/'],
  ['profile_url', 'https://www.facebook.com/alexey.denisov'],
] as const;

const receipts = await Promise.all(
  sources.map(([platform, sourceUrl]) =>
    retrieveReputationSourceReceipt({ candidateId, platform, sourceUrl }),
  ),
);

const identifierReceipts = declaredIdentifiers.map(([identifierType, value]) =>
  createCandidateDeclaredIdentifierReceipt({
    candidateId,
    identifierType,
    value,
  }),
);

console.log(
  JSON.stringify({
    candidateId,
    declaredIdentifierReceipts: identifierReceipts.map((receipt) => ({
      identifierType: receipt.identifierType,
      identifierSha256: receipt.identifierSha256,
      observedAt: receipt.observedAt,
      identityBinding: receipt.identityBinding,
      coverage: receipt.coverage,
    })),
  }),
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
