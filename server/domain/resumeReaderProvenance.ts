import type { ResumeReaderProvenance } from '../data/candidateStore';
import type { ResumeStructurer } from '../providers/resumeStructurer';

export function rulesReaderProvenance(): ResumeReaderProvenance {
  return { method: 'rules', model: null, promptRevision: null, readAt: new Date().toISOString() };
}

export function modelReaderProvenance(structurer: ResumeStructurer): ResumeReaderProvenance {
  return {
    method: 'model',
    model: structurer.provenance?.model ?? 'unknown',
    promptRevision: structurer.provenance?.promptRevision ?? 'unknown',
    readAt: new Date().toISOString(),
  };
}
