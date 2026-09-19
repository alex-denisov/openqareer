import { createHash, randomUUID } from 'node:crypto';

export type ReputationReceiptStatus = 'retrieved' | 'blocked' | 'not_found' | 'failed';

export interface ReputationSourceReceipt {
  readonly id: string;
  readonly candidateId: string;
  readonly platform: string;
  readonly sourceUrl: string;
  readonly finalUrl?: string;
  readonly observedAt: string;
  readonly status: ReputationReceiptStatus;
  readonly httpStatus?: number;
  readonly contentType?: string;
  readonly contentBytes?: number;
  readonly contentSha256?: string;
  /** Declared source ownership is not proof of identity; it is the binding input. */
  readonly identityBinding: 'candidate_declared_source';
  readonly coverage: 'retrieval_only' | 'content_retrieved' | 'blocked' | 'not_found';
  readonly diagnostic?: string;
}

export interface ReputationSourceReceiptInput {
  readonly candidateId: string;
  readonly platform: string;
  readonly sourceUrl: string;
}

export type CandidateDeclaredIdentifierType = 'email' | 'phone' | 'profile_url';

/**
 * A receipt for an identifier the candidate explicitly declared as theirs.
 * The value itself never enters the receipt: only a deterministic digest is
 * retained so a controlled run can be audited without persisting PII.
 */
export interface CandidateDeclaredIdentifierReceipt {
  readonly id: string;
  readonly candidateId: string;
  readonly identifierType: CandidateDeclaredIdentifierType;
  readonly identifierSha256: string;
  readonly observedAt: string;
  readonly identityBinding: 'candidate_declared_identifier';
  readonly coverage: 'declaration_only';
}

export interface CandidateDeclaredIdentifierInput {
  readonly candidateId: string;
  readonly identifierType: CandidateDeclaredIdentifierType;
  readonly value: string;
}

export interface ReputationReceiptFetcher {
  fetch?: typeof fetch;
  now?: () => string;
  timeoutMs?: number;
  maxBytes?: number;
}

const ALLOWED_HOSTS = [
  'facebook.com',
  'github.com',
  'habr.com',
  'instagram.com',
  'linkedin.com',
  't.me',
  'telegram.me',
  'hh.ru',
] as const;

function isAllowedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, '');
  return ALLOWED_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

export function normalizeReputationSourceUrl(rawUrl: string): string {
  const url = new URL(rawUrl.trim());
  if (url.protocol !== 'https:') throw new Error('reputation_source_requires_https');
  if (!isAllowedHost(url.hostname)) throw new Error('reputation_source_host_not_allowed');
  url.hash = '';
  return url.toString();
}

function canonicalDeclaredIdentifier(input: CandidateDeclaredIdentifierInput): string {
  const value = input.value.trim();
  if (!value) throw new Error('candidate_identifier_required');

  if (input.identifierType === 'email') {
    const email = value.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error('candidate_identifier_email_invalid');
    }
    return email;
  }

  if (input.identifierType === 'phone') {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      throw new Error('candidate_identifier_phone_invalid');
    }
    return digits;
  }

  return normalizeReputationSourceUrl(value);
}

export function createCandidateDeclaredIdentifierReceipt(
  input: CandidateDeclaredIdentifierInput,
  options: { now?: () => string } = {},
): CandidateDeclaredIdentifierReceipt {
  if (!input.candidateId.trim()) throw new Error('reputation_receipt_candidate_required');
  const canonical = canonicalDeclaredIdentifier(input);
  return {
    id: randomUUID(),
    candidateId: input.candidateId,
    identifierType: input.identifierType,
    identifierSha256: createHash('sha256').update(canonical).digest('hex'),
    observedAt: (options.now ?? (() => new Date().toISOString()))(),
    identityBinding: 'candidate_declared_identifier',
    coverage: 'declaration_only',
  };
}

function receiptBase(
  input: ReputationSourceReceiptInput,
  observedAt: string,
  sourceUrl: string,
): Pick<ReputationSourceReceipt, 'id' | 'candidateId' | 'platform' | 'sourceUrl' | 'observedAt' | 'identityBinding'> {
  return {
    id: randomUUID(),
    candidateId: input.candidateId,
    platform: input.platform,
    sourceUrl,
    observedAt,
    identityBinding: 'candidate_declared_source',
  };
}

// eslint-disable-next-line max-lines-per-function
async function receiptFromResponse(
  response: Response,
  base: Pick<ReputationSourceReceipt, 'id' | 'candidateId' | 'platform' | 'sourceUrl' | 'observedAt' | 'identityBinding'>,
  maxBytes: number,
): Promise<ReputationSourceReceipt> {
  const finalUrl = response.url || base.sourceUrl;
  const final = new URL(finalUrl);
  if (!isAllowedHost(final.hostname)) {
    return {
      ...base,
      finalUrl,
      status: 'blocked',
      httpStatus: response.status,
      identityBinding: 'candidate_declared_source',
      coverage: 'blocked',
      diagnostic: 'redirect_host_not_allowed',
    };
  }

  const contentType = response.headers.get('content-type') ?? undefined;
  const declaredBytes = Number(response.headers.get('content-length') ?? '0');
  if (declaredBytes > maxBytes) {
    return {
      ...base,
      finalUrl,
      status: 'blocked',
      httpStatus: response.status,
      contentType,
      contentBytes: declaredBytes,
      identityBinding: 'candidate_declared_source',
      coverage: 'blocked',
      diagnostic: 'content_too_large',
    };
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > maxBytes) {
    return {
      ...base,
      finalUrl,
      status: 'blocked',
      httpStatus: response.status,
      contentType,
      contentBytes: body.byteLength,
      identityBinding: 'candidate_declared_source',
      coverage: 'blocked',
      diagnostic: 'content_too_large',
    };
  }

  const contentSha256 = createHash('sha256').update(body).digest('hex');
  const status: ReputationReceiptStatus =
    response.status === 404
      ? 'not_found'
      : response.status === 401 || response.status === 403 || response.status === 429 || response.status === 999
        ? 'blocked'
        : response.ok
          ? 'retrieved'
          : 'failed';
  return {
    ...base,
    finalUrl,
    status,
    httpStatus: response.status,
    contentType,
    contentBytes: body.byteLength,
    contentSha256,
    identityBinding: 'candidate_declared_source',
    coverage: status === 'retrieved' ? 'content_retrieved' : status === 'not_found' ? 'not_found' : status === 'blocked' ? 'blocked' : 'retrieval_only',
  };
}

export async function retrieveReputationSourceReceipt(
  input: ReputationSourceReceiptInput,
  options: ReputationReceiptFetcher = {},
): Promise<ReputationSourceReceipt> {
  if (!input.candidateId.trim()) throw new Error('reputation_receipt_candidate_required');
  const sourceUrl = normalizeReputationSourceUrl(input.sourceUrl);
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const base = receiptBase(input, observedAt, sourceUrl);
  const request = options.fetch ?? fetch;

  try {
    const response = await request(sourceUrl, {
      headers: {
        'User-Agent': 'OpenQareer-reputation-receipt/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
    return receiptFromResponse(response, base, maxBytes);
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      identityBinding: 'candidate_declared_source',
      coverage: 'retrieval_only',
      diagnostic: error instanceof Error ? error.name : 'fetch_failed',
    };
  }
}
