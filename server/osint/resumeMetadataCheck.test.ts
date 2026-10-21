import { describe, expect, it } from 'vitest';
import { checkResumeFileMetadata } from './resumeMetadataCheck';

const pdf = (info: string) =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< ${info} >>\nendobj\ntrailer\n<< /Info 1 0 R >>\n%%EOF`,
  ).toString('base64');

function doc(id: string, contentBase64: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    familyId: id,
    version: 1,
    kind: 'resume' as const,
    source: 'upload' as const,
    fileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    byteSize: 1,
    sha256: 'x',
    parseStatus: 'ready' as const,
    retentionUntil: null,
    supersedesDocumentId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    contentBase64,
    extractedText: null,
    ...patch,
  };
}

describe('checkResumeFileMetadata (B544)', () => {
  it('reports files whose metadata names an author or company, ignoring the producing software', async () => {
    const docs = [
      doc('dirty', pdf('/Author (Andrey Lebedev) /Company (Fintech Lab)')),
      doc('clean', pdf('/Producer (Chrome)')),
    ];
    const result = await checkResumeFileMetadata(docs, () => '2026-10-21T10:00:00.000Z');
    expect(result.checkedFiles).toBe(2);
    expect(result.files.map((file) => file.fileName)).toEqual(['dirty.pdf']);
    expect(result.files[0]?.problems.length).toBeGreaterThan(0);
  });

  it('checks only the latest version of each resume', async () => {
    const result = await checkResumeFileMetadata(
      [
        doc('v1', pdf('/Author (Old)'), { familyId: 'f', version: 1 }),
        doc('v2', pdf('/Producer (Chrome)'), { familyId: 'f', version: 2 }),
        doc('letter', pdf('/Author (X)'), { kind: 'cover_letter' }),
      ],
      () => 'now',
    );
    expect(result).toMatchObject({ checkedFiles: 1, files: [] });
  });
});
