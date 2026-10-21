/**
 * B544, чек-лист «Метаданные файлов чисты» (US-02.4): runs the document
 * metadata inspector (B368) over the candidate's latest resume files and
 * reports which still carry an author, company, edit history, path or GPS.
 * The producing software alone is not a problem.
 */
import type { CandidateDocumentWithContent } from '../data/candidateStore';
import type { FootprintMetadataCheck } from '../../shared/footprintChecklist';
import { DocumentMetadataAdapter } from './adapters/documentMetadata';

const CHECKED_MIME_TYPES: Readonly<Record<string, 'pdf' | 'docx'>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const HARMLESS_TITLE = 'Метаданные документа: программное обеспечение';

function latestResumes(
  documents: readonly CandidateDocumentWithContent[],
): CandidateDocumentWithContent[] {
  const latest = new Map<string, CandidateDocumentWithContent>();
  for (const document of documents) {
    if (document.kind !== 'resume' || !CHECKED_MIME_TYPES[document.mimeType]) continue;
    const current = latest.get(document.familyId);
    if (!current || document.version > current.version) latest.set(document.familyId, document);
  }
  return [...latest.values()];
}

export async function checkResumeFileMetadata(
  documents: readonly CandidateDocumentWithContent[],
  now: () => string = () => new Date().toISOString(),
): Promise<FootprintMetadataCheck> {
  const adapter = new DocumentMetadataAdapter();
  const resumes = latestResumes(documents);
  const files: FootprintMetadataCheck['files'][number][] = [];
  for (const document of resumes) {
    const findings = await adapter.run({
      buffer: Buffer.from(document.contentBase64, 'base64'),
      filename: document.fileName,
      fileType: CHECKED_MIME_TYPES[document.mimeType],
    });
    const problems = findings
      .filter((finding) => finding.title !== HARMLESS_TITLE)
      .map((finding) => finding.title);
    if (problems.length) {
      files.push({ documentId: document.id, fileName: document.fileName, problems });
    }
  }
  return { checkedAt: now(), checkedFiles: resumes.length, files };
}
