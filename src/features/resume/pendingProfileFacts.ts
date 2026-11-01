import type { CandidateMemory } from '../coach/coachApi';
import type { ResumeDraft } from './resumeTypes';

const MEMORY_KEY = /MemoryIds?$/u;

/** Every fact id the draft links to (`chronologyMemoryId`, `bulletMemoryIds`, `evidenceMemoryId`…). */
function linkedFactIds(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => linkedFactIds(item, into));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (MEMORY_KEY.test(key)) {
        (Array.isArray(item) ? item : [item]).forEach(
          (id) => typeof id === 'string' && into.add(id),
        );
      } else {
        linkedFactIds(item, into);
      }
    }
  }
  return into;
}

/**
 * «N фактов ждут подтверждения» counts only facts the profile shows. On 02.11
 * the owner's counter read 1 for a chat remark («я руковожу IT и разработкой»)
 * no section displays, so it could never be found or confirmed there.
 */
export function pendingProfileFactCount(
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
): number {
  const linked = linkedFactIds(draft, new Set());
  return memory.filter(
    (item) => item.kind === 'fact' && item.status === 'proposed' && linked.has(item.id),
  ).length;
}
