import type { DatabaseSync } from 'node:sqlite';

export type ApplicationMaterialRole = 'cover_letter' | 'resume';

export interface StoredApplicationMaterial {
  readonly role: ApplicationMaterialRole;
  readonly documentId: string;
  readonly linkedAt: string;
}

/**
 * `PUT /applications/:id/materials/:role` (B251, S2, architecture.md §3).
 * One current document per role: PK `(application_id, role)`. Older versions
 * stay in `candidate_documents`'s own version chain, not here.
 */
export class SqliteApplicationMaterialsRepository {
  constructor(private readonly database: DatabaseSync) {}

  link(
    applicationId: string,
    role: ApplicationMaterialRole,
    documentId: string,
    now = new Date().toISOString(),
  ): StoredApplicationMaterial {
    this.database
      .prepare(
        `INSERT INTO application_materials (application_id, role, document_id, linked_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (application_id, role) DO UPDATE SET
           document_id = excluded.document_id, linked_at = excluded.linked_at`,
      )
      .run(applicationId, role, documentId, now);
    return { role, documentId, linkedAt: now };
  }

  list(applicationId: string): StoredApplicationMaterial[] {
    const rows = this.database
      .prepare('SELECT role, document_id, linked_at FROM application_materials WHERE application_id = ?')
      .all(applicationId) as unknown as Array<{ role: string; document_id: string; linked_at: string }>;
    return rows.map((row) => ({
      role: row.role as ApplicationMaterialRole,
      documentId: row.document_id,
      linkedAt: row.linked_at,
    }));
  }
}
