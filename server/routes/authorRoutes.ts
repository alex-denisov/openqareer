import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { AUTHOR_ACCOUNT, AUTHOR_PHOTO_PATH, RETIRED_AUTHOR_PATH } from '../../shared/author';

export interface AuthorPhoto {
  readonly mime: string;
  readonly bytes: Buffer;
}

/** Reads the author's current profile photo; null when the profile has none. */
export type AuthorPhotoReader = () => AuthorPhoto | null;

interface PhotoStore {
  getResumeCandidate(candidateId: string): { readonly photoMediaId?: string } | null;
  getCandidateMedia(candidateId: string, mediaId: string): AuthorPhoto | null;
}

/**
 * One source for the photo: the account's current profile photo
 * (`resume_drafts.photoMediaId` → `candidate_media`), never a copy in git.
 */
export function profilePhotoReader(databasePath: string, store: PhotoStore): AuthorPhotoReader {
  return () => {
    if (databasePath === ':memory:' || !existsSync(databasePath)) return null;
    const database = new DatabaseSync(databasePath, { readOnly: true });
    let candidateId: string | undefined;
    try {
      const row = database
        .prepare('SELECT candidate_id FROM users WHERE username = ?')
        .get(AUTHOR_ACCOUNT) as { candidate_id: string | null } | undefined;
      candidateId = row?.candidate_id ?? undefined;
    } finally {
      database.close();
    }
    if (!candidateId) return null;
    const mediaId = store.getResumeCandidate(candidateId)?.photoMediaId;
    return mediaId ? store.getCandidateMedia(candidateId, mediaId) : null;
  };
}

const PHOTO_TTL_MS = 5 * 60_000;

export function registerAuthorRoutes(
  app: FastifyInstance,
  options: { readonly readPhoto?: AuthorPhotoReader },
): void {
  let cached: { at: number; photo: AuthorPhoto | null } | undefined;

  // 09.11: the author page was removed at the owner's request; the address is permanent-redirected.
  app.get(RETIRED_AUTHOR_PATH, (_request, reply) => reply.redirect('/', 301));

  app.get(AUTHOR_PHOTO_PATH, (request, reply) => {
    const now = Date.now();
    if (!cached || now - cached.at > PHOTO_TTL_MS) {
      try {
        cached = { at: now, photo: options.readPhoto?.() ?? null };
      } catch (error) {
        request.log.error({ err: error }, 'author photo read failed');
        cached = { at: now, photo: null };
      }
    }
    if (!cached.photo) return reply.code(404).header('X-Robots-Tag', 'noindex').send('Нет фото');
    return reply
      .type(cached.photo.mime)
      .header('Cache-Control', 'public, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .send(cached.photo.bytes);
  });
}
