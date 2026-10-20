import type { ExperienceRevisionField } from './experienceRevisionField';

/**
 * B340 срез 1 — устойчивый ключ предложения консультанта (раздел + хеш текста).
 * Работает одинаково на сервере и клиенте без асинхронного crypto.
 */
export function computeProposalKey(
  section: string,
  proposedText: string,
  field?: ExperienceRevisionField | null,
): string {
  let hash = 0x811c9dc5;
  const normalized = proposedText.trim();
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const target = field ? `${section}:${field}` : section;
  return `${target}:${hash.toString(36)}`;
}

export function consultantProposalKey(proposal: {
  section?: string;
  resumeRevision?: {
    section?: string;
    field?: ExperienceRevisionField | null;
    proposedText?: string;
  } | null;
}): string {
  const section = proposal.resumeRevision?.section ?? proposal.section ?? 'general';
  const text = proposal.resumeRevision?.proposedText ?? '';
  const field = proposal.resumeRevision?.field;
  return computeProposalKey(section, text, field);
}
