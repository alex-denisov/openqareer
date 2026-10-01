import type { DatabaseSync } from 'node:sqlite';
import type { CareerActionProposal } from '../../domain/coach';
import { computeProposalKey } from '../../../shared/consultantProposalKey';
import type { ConsultantRejection } from '../candidateStore';

export class ConsultantRejectionStore {
  constructor(private readonly database: DatabaseSync) {}

  reject(
    candidateId: string,
    proposalKey: string,
    reason?: string,
    now = new Date().toISOString(),
  ): void {
    this.database
      .prepare(
        `INSERT INTO consultant_rejections (candidate_id, proposal_key, reason, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (candidate_id, proposal_key) DO UPDATE SET reason = excluded.reason`,
      )
      .run(candidateId, proposalKey, reason ?? null, now);
  }

  list(candidateId: string): ConsultantRejection[] {
    const rows = this.database
      .prepare(
        `SELECT proposal_key AS proposalKey, reason, created_at AS createdAt
         FROM consultant_rejections
         WHERE candidate_id = ?
         ORDER BY created_at`,
      )
      .all(candidateId) as unknown as ConsultantRejection[];
    return rows;
  }

  formatForModelInput(candidateId: string): string[] {
    return this.list(candidateId).map((r) => {
      const section = r.proposalKey.split(':')[0] || 'раздел';
      const reason = r.reason ? r.reason : 'отклонено кандидатом';
      return `Отклонено: ${section} — ${reason}`;
    });
  }

  filterProposals(
    candidateId: string,
    proposals?: CareerActionProposal[],
  ): CareerActionProposal[] {
    if (!proposals?.length) return proposals ?? [];
    const rejectedKeys = new Set(this.list(candidateId).map((r) => r.proposalKey));
    return proposals.filter((p) => {
      if (p.kind === 'resume.revise' && p.resumeRevision) {
        const key = computeProposalKey(p.resumeRevision.section, p.resumeRevision.proposedText);
        return !rejectedKeys.has(key);
      }
      return true;
    });
  }
}
