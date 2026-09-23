import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { carriesProfileSubstance, newImportMemoryIdPrefix } from '../domain/resumeImport';
import {
  attachResumeMedia,
  canonicalJson,
  collectMediaRequests,
  linkedinProfileV2ToParsedResume,
  planStructuredResumeImport,
} from '../domain/structuredResumeImport';
import { resolveCandidateMedia, type DownloadedMedia } from '../domain/candidateMedia';
import { nativeSourceConnectionView } from '../connectors/nativeSourceConnection';
import type { Handler } from './candidateRoutes';
import { resumeStudioView } from './candidateRoutes';
import { structuredResumeImportSchema } from './schemas';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError } from './helpers';

/**
 * `POST /candidate/resume/import/structured` (B265 §2, slice 3). The DOM was
 * already parsed on the candidate's device; nothing here calls a text reader
 * or a model, and a payload without `schemaVersion: 2` never reaches this
 * function at all — `structuredResumeImportSchema` rejects it first.
 */
function structuredImportDigest(
  candidateId: string,
  sourceReceipt: z.infer<typeof structuredResumeImportSchema>['sourceReceipt'],
  profile: z.infer<typeof structuredResumeImportSchema>['profile'],
): string {
  return createHash('sha256')
    .update(candidateId)
    .update('\0')
    .update(sourceReceipt.platform)
    .update('\0')
    .update(sourceReceipt.sourceUrl)
    .update('\0')
    .update(canonicalJson(profile))
    .digest('hex');
}

type StructuredImportBody = z.infer<typeof structuredResumeImportSchema>;

async function resolveStructuredMedia(
  candidateId: string,
  profile: StructuredImportBody['profile'],
): Promise<ReadonlyMap<string, DownloadedMedia>> {
  const mediaRequests = collectMediaRequests(profile);
  if (mediaRequests.length === 0) return new Map();
  return resolveCandidateMedia({ candidateId, items: mediaRequests, fetchImpl: fetch });
}

async function commitStructuredImport(
  deps: Parameters<Handler>[0],
  candidateId: string,
  body: StructuredImportBody,
  importDigest: string,
  plan: ReturnType<typeof planStructuredResumeImport>,
) {
  const mediaBySourceUrl = await resolveStructuredMedia(candidateId, body.profile);
  const draft = attachResumeMedia(plan.draft, body.profile, mediaBySourceUrl);
  const committed = deps.candidateStore.commitResumeImport(candidateId, {
    evidence: {
      sourceLabel: 'Импорт: профиль LinkedIn',
      sourceDigest: importDigest,
      entries: plan.evidence.map((item) => ({
        memoryId: item.memoryId,
        domain: item.domain,
        statement: item.statement,
      })),
    },
    draft,
    sourceReceipt: { ...body.sourceReceipt, importDigest },
    media: [...mediaBySourceUrl.values()],
  });
  return {
    resume: resumeStudioView(deps.candidateStore, candidateId),
    factCount: committed.evidence.memoryIds.length,
    ...(committed.sourceConnection
      ? { connection: nativeSourceConnectionView(committed.sourceConnection) }
      : {}),
  };
}

export const handleImportStructuredResume: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = structuredResumeImportSchema.parse(request.body);
  const importDigest = structuredImportDigest(candidate.id, body.sourceReceipt, body.profile);

  const replay = candidateStore.findNativeSourceConnectionByDigest(
    candidate.id,
    'linkedin',
    importDigest,
  );
  if (replay) {
    return {
      data: {
        resume: resumeStudioView(candidateStore, candidate.id),
        factCount: replay.receipt.factCount,
      },
      meta: { requestId: request.id, idempotentReplay: true },
    };
  }

  const plan = planStructuredResumeImport(body.profile, {
    idPrefix: newImportMemoryIdPrefix(randomUUID()),
  });
  if (
    plan.evidence.length === 0 ||
    !carriesProfileSubstance(linkedinProfileV2ToParsedResume(body.profile))
  ) {
    return sendError(
      reply,
      request,
      422,
      'resume_without_facts',
      'В профиле не нашлось ни одного факта для резюме.',
      false,
    );
  }

  const data = await commitStructuredImport(deps, candidate.id, body, importDigest, plan);
  return { data, meta: { requestId: request.id } };
};
