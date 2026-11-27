import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { StoredCandidateDocument } from '../data/candidateStore';
import {
  letterFactSource,
  letterFreshness,
  type LetterFactMark,
  type LetterFactSource,
  type LetterFreshness,
} from '../domain/letterFreshness';
import type { RouteDeps } from './deps';
import { authenticateCandidate } from './helpers';
import { attachedVersion } from './letterApprovalResume';
import { letterVacancyTexts, type LetterDraftDeps } from './letterDraftRoutes';

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
  language: z.enum(['en', 'ru']).optional(),
  tone: z.enum(['executive', 'confident', 'technical']).optional(),
  /** С B711 снимок помнит привязанное резюме; у прежних снимков поля нет. */
  resume: attachedResumeSchema.nullable().optional(),
  /** С какими фактами письмо одобрено; у прежних снимков поля нет. */
  factMark: z.object({ profileHash: z.string(), ownNumbers: z.array(z.string()) }).optional(),
});

export interface StoredLetterApproval extends LetterFreshness {
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
  /** Язык и тон одобренного письма (B645): экран показывает их после перезагрузки; `null` — нет в снимке. */
  readonly language: 'en' | 'ru' | null;
  readonly tone: 'executive' | 'confident' | 'technical' | null;
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
  source: LetterFactSource,
): StoredLetterApproval | null {
  const { candidateStore } = deps;
  for (const document of recentApprovalDocuments(deps, candidateId)) {
    const snapshot = readSnapshot(deps, candidateId, document);
    if (!snapshot || snapshot.vacancyId !== vacancyId) continue;
    if (!candidateStore.getApplication(candidateId, snapshot.applicationId)) continue;
    return {
      applicationId: snapshot.applicationId,
      documentId: document.id,
      approvedAt: snapshot.approvedAt,
      status: 'approved',
      sent: false,
      resume: shownResume(deps, candidateId, snapshot.applicationId, snapshot.resume ?? null),
      subject: snapshot.subject ?? null,
      body: snapshot.body,
      variantId: snapshot.variantId ?? null,
      language: snapshot.language ?? null,
      tone: snapshot.tone ?? null,
      ...freshnessOf(deps, vacancyId, source, snapshot.body, snapshot.factMark ?? null),
    };
  }
  return null;
}

/** Показанную позже версию кандидат одобрил отдельно (B785). */
function shownResume(
  deps: RouteDeps,
  candidateId: string,
  applicationId: string,
  approved: StoredLetterApproval['resume'],
): StoredLetterApproval['resume'] {
  if (approved?.kind !== 'targeted') return approved;
  const attached = attachedVersion(deps, candidateId, applicationId);
  return attached && attached.versionId !== approved.versionId ? attached : approved;
}

function freshnessOf(
  deps: RouteDeps,
  vacancyId: string,
  source: LetterFactSource,
  body: string,
  mark: LetterFactMark | null,
): LetterFreshness {
  return letterFreshness(source, body, letterVacancyTexts(deps, vacancyId), mark);
}

/** Правка письма до одобрения; одобренное письмо она не заменяет. */
function storedDraft(
  deps: LetterDraftDeps,
  candidateId: string,
  vacancyId: string,
  source: LetterFactSource,
) {
  const draft = deps.letterDrafts.read(candidateId, vacancyId);
  if (!draft) return null;
  const { body, variantId, savedAt, mark } = draft;
  return { body, variantId, savedAt, ...freshnessOf(deps, vacancyId, source, body, mark) };
}

function recentApprovalDocuments(deps: RouteDeps, candidateId: string): StoredCandidateDocument[] {
  return deps.candidateStore
    .getSnapshot(candidateId)
    .documents.filter(
      (document) =>
        document.kind === 'cover_letter' && document.fileName.startsWith(APPROVED_LETTER_PREFIX),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_APPROVALS_SCANNED);
}

/**
 * Отклики кандидата с одобренным письмом (B645): список «Откликов» показывает у черновика
 * то же, что экран письма. Удалённые заявки не попадают. Ничего не пишет.
 */
export function approvedLetterApplicationIds(deps: RouteDeps, candidateId: string): string[] {
  const ids = new Set<string>();
  for (const document of recentApprovalDocuments(deps, candidateId)) {
    const snapshot = readSnapshot(deps, candidateId, document);
    if (!snapshot || ids.has(snapshot.applicationId)) continue;
    if (deps.candidateStore.getApplication(candidateId, snapshot.applicationId))
      ids.add(snapshot.applicationId);
  }
  return [...ids];
}

/** `GET /api/v1/candidate/vacancies/:id/letter-approvals/latest`. */
export async function handleReadLetterApproval(
  deps: LetterDraftDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const source = letterFactSource(candidateStore.getSnapshot(candidate.id));
  return {
    data: {
      approval: latestLetterApproval(deps, candidate.id, vacancyId, source),
      draft: storedDraft(deps, candidate.id, vacancyId, source),
    },
    meta: { requestId: request.id },
  };
}
