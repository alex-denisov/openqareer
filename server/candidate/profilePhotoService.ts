import { createHash, randomUUID } from 'node:crypto';
import type { CandidateStore } from '../data/candidateStore';
import type { SqliteCandidateMediaRepository } from '../data/sqliteCandidateMediaRepository';
import { normalizeProfilePhoto } from '../domain/profilePhoto';
import type { ResumeDraft } from '../domain/resumeDraft';
import { buildResumeStudioProjection } from '../domain/resumeStudio';

/**
 * B666: своё фото профиля. Файл проходит `normalizeProfilePhoto`, очищенный
 * JPEG ложится в `candidate_media` (запечатан, отдаётся только владельцу), а
 * профиль ссылается на него через `photoMediaId`. Прежнее фото убирает само
 * сохранение профиля: оно чистит файлы, на которые профиль больше не ссылается.
 */
export const PHOTO_HISTORY_SECTION = 'photo';
const PHOTO_HISTORY_LABEL = 'Фото профиля';

export interface ProfilePhotoDeps {
  readonly media: Pick<SqliteCandidateMediaRepository, 'saveMany'>;
  readonly store: Pick<CandidateStore, 'getSnapshot' | 'saveResumeDraft' | 'profileChangeLog'>;
}

/** Профиля ещё нет: фото не к чему приложить. */
export class ProfileMissingError extends Error {
  constructor() {
    super('Сначала добавьте в профиль опыт.');
  }
}

/** Фото из LinkedIn нет: профиль не импортировали из LinkedIn или там не было фото. */
export class LinkedinPhotoMissingError extends Error {
  constructor() {
    super('Фото из LinkedIn нет.');
  }
}

export interface ProfilePhotoResult {
  readonly photoMediaId: string | null;
}

function newMediaId(candidateId: string): string {
  return createHash('sha256')
    .update(candidateId)
    .update('\0photo\0upload\0')
    .update(randomUUID())
    .digest('hex')
    .slice(0, 32);
}

function saveDraft(deps: ProfilePhotoDeps, candidateId: string, draft: ResumeDraft): void {
  const snapshot = deps.store.getSnapshot(candidateId);
  const projection = buildResumeStudioProjection({ ...draft, evidence: snapshot.memory });
  deps.store.saveResumeDraft(candidateId, draft, projection.evidenceSnapshot);
}

function logChange(
  deps: ProfilePhotoDeps,
  candidateId: string,
  previous: string,
  applied: string,
  now: Date,
): void {
  deps.store.profileChangeLog.record({
    id: randomUUID(),
    candidateId,
    actor: 'candidate',
    section: PHOTO_HISTORY_SECTION,
    itemId: null,
    label: PHOTO_HISTORY_LABEL,
    previous,
    applied,
    commandId: null,
    createdAt: now.toISOString(),
  });
}

/** Проверяет файл, сохраняет очищенное фото и ставит его в профиль. */
export function setProfilePhoto(
  deps: ProfilePhotoDeps,
  candidateId: string,
  file: Buffer,
  now: Date,
): ProfilePhotoResult {
  const photo = normalizeProfilePhoto(file);
  const draft = deps.store.getSnapshot(candidateId).resume?.draft;
  if (!draft) throw new ProfileMissingError();
  const mediaId = newMediaId(candidateId);
  deps.media.saveMany(candidateId, [
    { mediaId, kind: 'photo', mime: photo.mime, bytes: photo.bytes },
  ]);
  const hadPhoto = Boolean(draft.candidate.photoMediaId);
  saveDraft(deps, candidateId, {
    ...draft,
    candidate: { ...draft.candidate, photoMediaId: mediaId },
  });
  logChange(deps, candidateId, hadPhoto ? 'прежнее фото' : '', 'новое фото', now);
  return { photoMediaId: mediaId };
}

/** Убирает фото из профиля; сам файл удаляется при сохранении профиля. */
export function removeProfilePhoto(
  deps: ProfilePhotoDeps,
  candidateId: string,
  now: Date,
): ProfilePhotoResult {
  const draft = deps.store.getSnapshot(candidateId).resume?.draft;
  if (!draft?.candidate.photoMediaId) return { photoMediaId: null };
  const { photoMediaId: _removed, ...candidate } = draft.candidate;
  saveDraft(deps, candidateId, { ...draft, candidate });
  logChange(deps, candidateId, 'фото', 'без фото', now);
  return { photoMediaId: null };
}

/** p08 «Взять из LinkedIn»: снова ставит фото из последнего импорта LinkedIn. */
export function takeLinkedinPhoto(
  deps: ProfilePhotoDeps,
  candidateId: string,
  now: Date,
): ProfilePhotoResult {
  const draft = deps.store.getSnapshot(candidateId).resume?.draft;
  const linkedinPhoto = draft?.candidate.linkedinPhotoMediaId;
  if (!draft || !linkedinPhoto) throw new LinkedinPhotoMissingError();
  if (draft.candidate.photoMediaId === linkedinPhoto) return { photoMediaId: linkedinPhoto };
  const hadPhoto = Boolean(draft.candidate.photoMediaId);
  saveDraft(deps, candidateId, {
    ...draft,
    candidate: { ...draft.candidate, photoMediaId: linkedinPhoto },
  });
  logChange(deps, candidateId, hadPhoto ? 'прежнее фото' : '', 'фото из LinkedIn', now);
  return { photoMediaId: linkedinPhoto };
}
