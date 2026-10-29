import type { StoredMemory } from '../data/candidateStore';
import {
  MANAGEMENT_SKILLS_DICTIONARY,
  canonicalizeSkill,
  extractManagementSkillsFromText,
} from '../connectors/managementSkillsDictionary';
import { normalizeTextForComparison } from '../vacancies/vacancyFingerprint';

/**
 * Как кандидат подтверждает навык и требование роли (блок A, пакет 3,
 * `BLOCK-A-p3-decision.md`). Беседа даёт «Разобрано в беседе», а не
 * «Подтверждено»: она фиксирует слова самого кандидата. Сопоставление
 * детерминированное, модель статус не ставит.
 */

export interface CoveringFact {
  readonly memoryId: string;
  readonly statement: string;
  /** Реплики беседы, из которых взят факт. */
  readonly sourceMessageIds: readonly string[];
  readonly at: string;
}

export interface ConversationCoverage {
  readonly name: string;
  readonly state: 'discussed' | 'not_checked';
  readonly facts: readonly CoveringFact[];
}

const MANAGEMENT_CANONICALS = new Set(MANAGEMENT_SKILLS_DICTIONARY.map((entry) => entry.canonical));

/**
 * Факт годится, если кандидат его подтвердил, он пришёл из беседы, у него есть
 * ссылка на реплику и число — масштаб (минимум консультанта, 29.10).
 */
function isConversationEvidence(memory: StoredMemory): boolean {
  if (memory.kind !== 'fact') return false;
  if (memory.status !== 'confirmed' && memory.status !== 'corrected') return false;
  const origin = memory.provenance?.kind;
  if (origin !== 'candidate' && origin !== 'consultant') return false;
  if (memory.sourceMessageIds.length === 0) return false;
  return /\p{N}/u.test(memory.statement);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namesRequirement(statement: string, requirement: string): boolean {
  const canonical = canonicalizeSkill(requirement);
  if (MANAGEMENT_CANONICALS.has(canonical)) {
    return extractManagementSkillsFromText(statement).includes(canonical);
  }
  const name = normalizeTextForComparison(requirement);
  if (!name) return false;
  const pattern = new RegExp(
    `(?<=^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`,
    'u',
  );
  return pattern.test(normalizeTextForComparison(statement));
}

/** Для каждого требования: какие подтверждённые факты беседы его называют. */
export function conversationCoverage(
  requirements: readonly string[],
  memory: readonly StoredMemory[],
): ConversationCoverage[] {
  const evidence = memory.filter(isConversationEvidence);
  return requirements.map((name) => {
    const facts = evidence
      .filter((item) => namesRequirement(item.statement, name))
      .map((item) => ({
        memoryId: item.id,
        statement: item.statement,
        sourceMessageIds: [...item.sourceMessageIds],
        at: item.provenance?.at ?? item.updatedAt,
      }));
    return { name, state: facts.length > 0 ? 'discussed' : 'not_checked', facts };
  });
}

/**
 * Квиз проверяет только знание с однозначным ответом. Руководство, продажи,
 * стратегия и прочие навыки словаря управленческих компетенций квизом не
 * проверяются — для них путь только беседа.
 */
export function isQuizCheckable(skillName: string): boolean {
  if (!skillName.trim()) return false;
  if (MANAGEMENT_CANONICALS.has(canonicalizeSkill(skillName))) return false;
  return extractManagementSkillsFromText(skillName).length === 0;
}
