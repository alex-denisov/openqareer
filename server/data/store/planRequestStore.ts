import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { PlanRequestId, StoredPlanRequest } from '../candidateStore';

/** B266: a paid-plan request, one row per candidate and plan (MIGRATION_34). */
export function insertPlanRequest(
  database: DatabaseSync,
  candidateId: string,
  planId: PlanRequestId,
  note: string | undefined,
): StoredPlanRequest {
  database
    .prepare(
      `INSERT INTO plan_requests (id, candidate_id, plan_id, note, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(candidate_id, plan_id) DO NOTHING`,
    )
    .run(randomUUID(), candidateId, planId, note ?? null, new Date().toISOString());
  const stored = selectPlanRequests(database, candidateId).find((row) => row.planId === planId);
  if (!stored) throw new Error('plan_request_not_persisted');
  return stored;
}

export function selectPlanRequests(database: DatabaseSync, candidateId: string): StoredPlanRequest[] {
  const rows = database
    .prepare('SELECT plan_id, created_at FROM plan_requests WHERE candidate_id = ? ORDER BY created_at')
    .all(candidateId) as { plan_id: PlanRequestId; created_at: string }[];
  return rows.map((row) => ({ planId: row.plan_id, createdAt: row.created_at }));
}
