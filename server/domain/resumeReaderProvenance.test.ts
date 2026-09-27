import { describe, expect, it } from 'vitest';
import type { ResumeStructurer } from '../providers/resumeStructurer';
import { modelReaderProvenance } from './resumeReaderProvenance';

describe('modelReaderProvenance (B184)', () => {
  it('records the model and prompt revision the structurer reports', () => {
    const structurer = {
      provenance: { model: 'gemini-3.8-flash', promptRevision: 'r7' },
    } as ResumeStructurer;
    expect(modelReaderProvenance(structurer)).toMatchObject({
      method: 'model',
      model: 'gemini-3.8-flash',
      promptRevision: 'r7',
    });
  });

  it('claims nothing when the structurer carries no model metadata', () => {
    expect(modelReaderProvenance({} as ResumeStructurer)).toBeNull();
  });
});
