import type { AdaptationApplications } from './adaptationApplications';
import { createHash } from 'node:crypto';
import type { AdaptationContext, AdaptationTaskSuggestion } from '../../shared/adaptationCoach';
import type { CareerDiaryWorkplace } from '../../shared/careerDiary';
import { careerDiaryPlanningSchema } from '../domain/careerDiaryAdaptation';

export function applyAdaptationTask(candidateId: string, context: AdaptationContext, key: string, edits: AdaptationTaskSuggestion & { dueDate: string }, get: (id: string) => CareerDiaryWorkplace | null, save: (workplace: CareerDiaryWorkplace) => void, receipts: AdaptationApplications, targetTaskId: string | null = null) {
  const workplace = get(context.workplaceId);
  const parsed = careerDiaryPlanningSchema.safeParse((workplace as { planning?: unknown } | null)?.planning);
  const plan = parsed.success ? parsed.data.adaptationPlan : null;
  if (!workplace || !plan || plan.id !== context.planId) return { status: 'missing' as const };
  if (workplace.status === 'archived' || plan.status === 'closed') return { status: 'read_only' as const };
  const receipt = receipts.get(candidateId, key);
  if (receipt) {
    const same = receipt.workplaceId === workplace.id && receipt.planId === plan.id && receipt.targetTaskId === targetTaskId && receipt.edits.title === edits.title && receipt.edits.description === edits.description && receipt.edits.dueDate === edits.dueDate;
    return same ? { status: 'saved' as const, workplace } : { status: 'conflict' as const };
  }
  const version = createHash('sha256').update(JSON.stringify(workplace)).digest('hex');
  if (version !== context.version) return { status: 'conflict' as const };
  const target = targetTaskId ? plan.tasks.find(task => task.id === targetTaskId && task.stage === context.stage) : null;
  if (targetTaskId && (!target || plan.tasks.filter(task => task.id === targetTaskId).length !== 1)) return { status: 'conflict' as const };
  if (!target && plan.tasks.length >= 100) return { status: 'limit' as const };
  const id = target?.id ?? 'coach-' + createHash('sha256').update(candidateId + ':' + key).digest('hex').slice(0, 40);
  if (!target && plan.tasks.some(task => task.id === id)) return { status: 'conflict' as const };
  const task = target ? { ...target, ...edits, source: 'candidate' as const } : { id, ...edits, stage: context.stage, category: 'alignment' as const, completed: false, source: 'candidate' as const };
  const tasks = target ? plan.tasks.map(item => item.id === id ? task : item) : [...plan.tasks, task];
  const now = new Date().toISOString();
  const updated = { ...workplace, planning: { adaptationPlan: { ...plan, tasks } }, updatedAt: now };
  save(updated);
  receipts.save(candidateId, { turnKey: key, workplaceId: workplace.id, planId: plan.id, taskId: id, targetTaskId, edits: { title: edits.title, description: edits.description, dueDate: edits.dueDate }, appliedAt: now });
  return { status: 'saved' as const, workplace: updated };
}
