import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { StoredCandidateDocument } from '../data/candidateStore';
import type { RouteDeps } from './deps';
import { authenticateCandidate } from './helpers';

/** Имя файла снимка одобренного письма: `approved-letter-<approvalId>.json`. */
export const APPROVED_LETTER_PREFIX = 'approved-letter-';

/** Сколько последних одобрений читается в поиске одобрения вакансии: чтение не растёт с историей. */
const MAX_APPROVALS_SCANNED = 50;

const attachedResumeSchema = z.object({
  kind: z.enum(['targeted', 'master', 'general']),
  versionId: z.string().nullable(),
  documentId: z.string(),
  snapshotAt: z.string(),
});

const storedSnapshotSchema = z.object({
  vacancyId: z.string(),
  applicationId: z.string(),
  approvedAt: z.string(),
  subject: z.string().nullable().optional(),
  body: z.string(),
  variantId: z.string().nullable().optional(),
  /** С B711 снимок помнит привязанное резюме; у прежних снимков поля нет. */
  resume: attachedResumeSchema.nullable().optional(),
});

export interface StoredLetterApproval {
  readonly applicationId: string;
  readonly documentId: string;
  readonly approvedAt: string;
  readonly status: 'approved';
  readonly sent: false;
  readonly resume: z.infer<typeof attachedResumeSchema> | null;
  readonly subject: string | null;
  readonly body: string;
  /** Какой вариант письма одобрен; `null` — первое письмо или снимок до B711. */
  readonly variantId: string | null;
}

function readSnapshot(deps: RouteDeps, candidateId: string, document: StoredCandidateDocument) {
  const stored = deps.candidateStore.getDocument(candidateId, document.id);
  if (!stored) return null;
  try {
    const parsed = storedSnapshotSchema.safeParse(
      JSON.parse(Buffer.from(stored.contentBase64, 'base64').toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Последнее одобренное письмо вакансии (B711): одобрение переживает уход с экрана и перезапуск.
 * Заявка удалена — одобрения нет. Ничего не пишет.
 */
export function latestLetterApproval(
  deps: RouteDeps,
  candidateId: string,
  vacancyId: string,
): StoredLetterApproval | null {
  const { candidateStore } = deps;
  const approvals = candidateStore
    .getSnapshot(candidateId)
    .documents.filter(
      (document) =>
        document.kind === 'cover_letter' && document.fileName.startsWith(APPROVED_LETTER_PREFIX),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_APPROVALS_SCANNED);
  for (const document of approvals) {
    const snapshot = readSnapshot(deps, candidateId, document);
    if (!snapshot || snapshot.vacancyId !== vacancyId) continue;
    if (!candidateStore.getApplication(candidateId, snapshot.applicationId)) continue;
    return {
      applicationId: snapshot.applicationId,
      documentId: document.id,
      approvedAt: snapshot.approvedAt,
      status: 'approved',
      sent: false,
      resume: snapshot.resume ?? null,
      subject: snapshot.subject ?? null,
      body: snapshot.body,
      variantId: snapshot.variantId ?? null,
    };
  }
  return null;
}

/** `GET /api/v1/candidate/vacancies/:id/letter-approvals/latest`. */
export async function handleReadLetterApproval(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  return {
    data: { approval: latestLetterApproval(deps, candidate.id, vacancyId) },
    meta: { requestId: request.id },
  };
}
