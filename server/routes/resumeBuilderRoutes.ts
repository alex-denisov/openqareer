import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { builderResumeSchema, RESUME_TEMPLATES } from '../../shared/resumeBuilder/model';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { renderResumeDocx } from '../resumeBuilder/resumeDocx';
import { renderResumePdf } from '../resumeBuilder/resumePdf';
import { extractVacancyKeywords } from '../resumeBuilder/vacancyKeywords';
import { poolIdFromVacancyLink } from '../resumeBuilder/vacancyLink';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const keywordsSchema = z
  .object({
    link: z.string().trim().max(2_048).optional(),
    text: z.string().trim().max(30_000).optional(),
  })
  .strict()
  .refine((body) => Boolean(body.link) !== Boolean(body.text), 'link_or_text');

const exportSchema = z
  .object({
    format: z.enum(['pdf', 'docx']),
    template: z.enum(RESUME_TEMPLATES),
    resume: builderResumeSchema,
  })
  .strict();

/** Below this the pool holds a search snippet, not the vacancy text. */
const THIN_DESCRIPTION = 400;
const MIN_PASTED_TEXT = 40;

export type KeywordsOutcome = 'text' | 'pool' | 'unsupported_link' | 'not_in_pool' | 'no_keywords';

function vacancyText(vacancy: UnifiedVacancy): string {
  return [
    vacancy.fullDescription ?? vacancy.description,
    ...(vacancy.qualifications ?? []),
    ...(vacancy.niceToHave ?? []),
  ].join('\n');
}

async function readPoolVacancy(deps: RouteDeps, id: string): Promise<UnifiedVacancy | undefined> {
  const stored = deps.multiSourceEngine.getVacancy(id);
  if (!stored || vacancyText(stored).length >= THIN_DESCRIPTION) return stored;
  // hh keeps only a snippet from search; the existing card reader (1 req/s, robots-gated) adds the text.
  const loaded = await deps.multiSourceEngine.loadVacancyDescription(id);
  return loaded.vacancy ?? stored;
}

function answer(
  request: FastifyRequest,
  outcome: KeywordsOutcome,
  keywords: readonly string[] = [],
  vacancy?: UnifiedVacancy,
) {
  request.log.info(
    { event: 'resume_builder_keywords', outcome, count: keywords.length },
    'resume_builder_keywords',
  );
  return {
    data: {
      outcome,
      keywords,
      ...(vacancy ? { vacancy: { title: vacancy.title, company: vacancy.company } } : {}),
    },
    meta: { requestId: request.id },
  };
}

const handleKeywords: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const parsed = keywordsSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_vacancy',
      'Вставьте ссылку на вакансию или её текст.',
      false,
    );
  }
  const { link, text } = parsed.data;
  if (text) {
    if (text.length < MIN_PASTED_TEXT) return answer(request, 'no_keywords');
    const keywords = extractVacancyKeywords(text);
    return answer(request, keywords.length ? 'text' : 'no_keywords', keywords);
  }
  const id = poolIdFromVacancyLink(link ?? '');
  if (!id) return answer(request, 'unsupported_link');
  const vacancy = await readPoolVacancy(deps, id);
  if (!vacancy) return answer(request, 'not_in_pool');
  const keywords = extractVacancyKeywords(vacancyText(vacancy), vacancy.requiredSkills);
  return answer(request, keywords.length ? 'pool' : 'no_keywords', keywords, vacancy);
};

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

const handleExport: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const parsed = exportSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_resume',
      'Резюме не прошло проверку полей.',
      false,
    );
  }
  const { format, template, resume } = parsed.data;
  try {
    const file =
      format === 'pdf'
        ? await renderResumePdf(resume, template)
        : await renderResumeDocx(resume, template);
    return reply
      .header('content-type', CONTENT_TYPES[format])
      .header('content-disposition', `attachment; filename="resume.${format}"`)
      .header('cache-control', 'no-store')
      .send(file);
  } catch (error) {
    request.log.error({ error, format, template }, 'resume_builder_export_failed');
    return sendError(
      reply,
      request,
      500,
      'resume_export_failed',
      'Не удалось собрать файл. Попробуйте ещё раз.',
      true,
    );
  }
};

/** B567: the public builder's vacancy keywords and the signed-in file export. */
export function registerResumeBuilderRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/resume-builder/keywords',
    { bodyLimit: 64 * 1024, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    withDeps(deps, handleKeywords),
  );
  app.post(
    '/api/v1/candidate/resume-builder/export',
    // Signed in: no request limit inside the product (owner, 23.10).
    { bodyLimit: 128 * 1024 },
    withDeps(deps, handleExport),
  );
}
