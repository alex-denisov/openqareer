import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { CommittedResumeImport } from '../data/candidateStore';
import { randomUUID } from 'node:crypto';
import { carriesProfileSubstance, newImportMemoryIdPrefix, planResumeImport } from '../domain/resumeImport';
import { preferStructuredResume } from '../domain/resumeStructuring';
import { structureWithinBudget, type ResumeStructurer } from '../providers/resumeStructurer';
import { parseResumeContent } from '../../src/features/workspace/resumeParser';
import { normalizeResumeSourceText } from '../../src/features/workspace/resumeSourceText';
import type { RouteDeps } from './deps';
import type { resumeImportSchema } from './schemas';

/**
 * 04.11: импорт ждал модель до 45 с и в 2 из 8 замеров всё равно отдавал правила (медиана 32 с).
 * Теперь кандидат сразу получает разбор правилами, а модель уточняет его фоном. Если кандидат за
 * это время изменил профиль, уточнение отбрасывается: правка кандидата важнее.
 */

type ParsedResume = ReturnType<typeof parseResumeContent>;

/** Фоном никто не ждёт: потолок только от зависшего запроса, не бюджет ожидания кандидата. */
const RESUME_REFINE_BUDGET_MS = 120_000;
const REFINEMENT_KEEP_MS = 10 * 60 * 1_000;

export type ResumeRefinementView =
  | { readonly status: 'none' | 'pending' | 'kept' }
  | { readonly status: 'refined'; readonly parsed: ParsedResume; readonly factCount: number };

interface RefinementEntry {
  readonly token: symbol;
  readonly view: ResumeRefinementView;
  readonly expiresAt: number;
}

const refinements = new Map<string, RefinementEntry>();

function setEntry(candidateId: string, token: symbol, view: ResumeRefinementView, nowMs = Date.now()): void {
  for (const [id, entry] of refinements) {
    if (entry.expiresAt <= nowMs) refinements.delete(id);
  }
  refinements.set(candidateId, { token, view, expiresAt: nowMs + REFINEMENT_KEEP_MS });
}

export function resumeRefinementOf(candidateId: string, nowMs = Date.now()): ResumeRefinementView {
  const entry = refinements.get(candidateId);
  return entry && entry.expiresAt > nowMs ? entry.view : { status: 'none' };
}

export interface ResumeRefinementInput {
  readonly deps: Pick<RouteDeps, 'candidateStore'>;
  readonly log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  readonly candidateId: string;
  readonly body: z.infer<typeof resumeImportSchema>;
  readonly structurer: ResumeStructurer;
  readonly committed: CommittedResumeImport;
  /** Те же запись и пересборка ролей, что у обычного импорта; только чтение модели другое. */
  readonly commit: (plan: ReturnType<typeof planResumeImport>) => CommittedResumeImport;
  readonly afterCommit: () => void;
}

/** Профиль остался таким, каким его записал импорт: тот же черновик, факты не разобраны. */
function profileUntouched(input: ResumeRefinementInput): boolean {
  const snapshot = input.deps.candidateStore.getSnapshot(input.candidateId);
  if (snapshot.resume?.updatedAt !== input.committed.resume.updatedAt) return false;
  const statuses = new Map(snapshot.memory.map((fact) => [fact.id, fact.status]));
  return input.committed.evidence.memoryIds.every((id) => statuses.get(id) === 'proposed');
}

async function refine(input: ResumeRefinementInput, isCurrent: () => boolean): Promise<ResumeRefinementView> {
  const source = normalizeResumeSourceText(input.body.text);
  const startedAt = Date.now();
  const structured = await structureWithinBudget(source, input.structurer, RESUME_REFINE_BUDGET_MS);
  const durationMs = Date.now() - startedAt;
  if (!isCurrent()) return { status: 'kept' };
  if (!structured) {
    input.log.info({ durationMs, outcome: 'no_model_answer' }, 'resume_import_refinement');
    return { status: 'kept' };
  }
  const resume = preferStructuredResume(structured, parseResumeContent(source));
  const plan = planResumeImport(resume, { idPrefix: newImportMemoryIdPrefix(randomUUID()) });
  if (plan.evidence.length === 0 || !carriesProfileSubstance(resume) || !profileUntouched(input)) {
    input.log.info({ durationMs, outcome: 'kept_rules' }, 'resume_import_refinement');
    return { status: 'kept' };
  }
  const committed = input.commit(plan);
  input.afterCommit();
  input.log.info(
    { durationMs, outcome: 'refined', factCount: committed.evidence.memoryIds.length },
    'resume_import_refinement',
  );
  return { status: 'refined', parsed: resume, factCount: committed.evidence.memoryIds.length };
}

/** Запускает уточнение фоном и сразу возвращается; новый импорт отменяет прежнее уточнение. */
export function startResumeRefinement(input: ResumeRefinementInput): void {
  const token = Symbol('resume-refinement');
  setEntry(input.candidateId, token, { status: 'pending' });
  const isCurrent = () => refinements.get(input.candidateId)?.token === token;
  void refine(input, isCurrent)
    .catch((error: unknown) => {
      input.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'resume_import_refinement_failed',
      );
      return { status: 'kept' } as const;
    })
    .then((view) => {
      if (isCurrent()) setEntry(input.candidateId, token, view);
    });
}

/** Ход импорта без уточнения снимает ожидание прежнего. */
export function clearResumeRefinement(candidateId: string): void {
  refinements.delete(candidateId);
}
