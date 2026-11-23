import type { CandidateStore } from '../data/candidateStore';
import { resumePhotoOf, type ResumePhoto } from '../resumeBuilder/resumePhoto';
import type { SqliteResumePhotoRepository } from './sqliteResumePhotoRepository';

export interface ResumePhotoDeps {
  readonly store: Pick<CandidateStore, 'getSnapshot' | 'getCandidateMedia'>;
  readonly setting: Pick<SqliteResumePhotoRepository, 'inResume'>;
}

/**
 * B666: фото профиля для шапки резюме — только когда «Фото в резюме» включено и фото
 * в профиле есть. Выключено — фото нет ни в одном файле.
 */
export function resumePhotoForExport(
  deps: ResumePhotoDeps,
  candidateId: string,
): ResumePhoto | null {
  if (!deps.setting.inResume(candidateId)) return null;
  const mediaId = deps.store.getSnapshot(candidateId).resume?.draft.candidate.photoMediaId;
  return mediaId ? resumePhotoOf(deps.store.getCandidateMedia(candidateId, mediaId)) : null;
}
