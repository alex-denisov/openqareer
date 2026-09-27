import type { ResumeReaderProvenance } from '../data/candidateStore';
import type { ResumeStructurer } from '../providers/resumeStructurer';

export function rulesReaderProvenance(): ResumeReaderProvenance {
  return { method: 'rules', model: null, promptRevision: null, readAt: new Date().toISOString() };
}

/** Без метаданных модели провенанс неизвестен: `null`, а не утверждение «читала модель unknown». */
export function modelReaderProvenance(structurer: ResumeStructurer): ResumeReaderProvenance | null {
  const provenance = structurer.provenance;
  if (!provenance) return null;
  return {
    method: 'model',
    model: provenance.model,
    promptRevision: provenance.promptRevision,
    readAt: new Date().toISOString(),
  };
}
