/**
 * B544, чек-лист «Метаданные файлов чисты» (US-02.4): runs the document
 * metadata inspector (B368) over the candidate's latest resume files and
 * reports which still carry an author, company, edit history, path or GPS.
 * The producing software alone is not a problem.
 */
import type { StoredCandidateDocument } from '../data/candidateStore';
import type { FootprintMetadataCheck } from '../../shared/footprintChecklist';
import { DocumentMetadataAdapter } from './adapters/documentMetadata';

const CHECKED_MIME_TYPES: Readonly<Record<string, 'pdf' | 'docx'>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const HARMLESS_TITLE = 'Метаданные документа: программное обеспечение';
const CACHE_MAX_ENTRIES = 1_000;

type MetadataDocument = Pick<
  StoredCandidateDocument,
  'id' | 'familyId' | 'version' | 'kind' | 'fileName' | 'mimeType' | 'sha256'
>;

/**
 * Problems per file content (sha256): the same bytes always give the same
 * metadata, so a file is read and parsed once. Bounded, oldest entry first out.
 */
export class MetadataProblemCache {
  private readonly entries = new Map<string, readonly string[]>();

  constructor(private readonly maxEntries = CACHE_MAX_ENTRIES) {}

  get(sha256: string): readonly string[] | undefined {
    const value = this.entries.get(sha256);
    if (value) {
      this.entries.delete(sha256);
      this.entries.set(sha256, value);
    }
    return value;
  }

  set(sha256: string, problems: readonly string[]): void {
    this.entries.delete(sha256);
    this.entries.set(sha256, problems);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}

const sharedCache = new MetadataProblemCache();

function latestResumes<T extends MetadataDocument>(documents: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const document of documents) {
    if (document.kind !== 'resume' || !CHECKED_MIME_TYPES[document.mimeType]) continue;
    const current = latest.get(document.familyId);
    if (!current || document.version > current.version) latest.set(document.familyId, document);
  }
  return [...latest.values()];
}

async function inspect(
  adapter: DocumentMetadataAdapter,
  document: MetadataDocument,
  contentBase64: string,
): Promise<readonly string[]> {
  const findings = await adapter.run({
    buffer: Buffer.from(contentBase64, 'base64'),
    filename: document.fileName,
    fileType: CHECKED_MIME_TYPES[document.mimeType],
  });
  return findings
    .filter((finding) => finding.title !== HARMLESS_TITLE)
    .map((finding) => finding.title);
}

/** `loadContent` is called only for files whose sha256 is not cached yet. */
export async function checkResumeFileMetadata(
  documents: readonly MetadataDocument[],
  loadContent: (documentId: string) => string | null,
  options: { readonly cache?: MetadataProblemCache; readonly now?: () => string } = {},
): Promise<FootprintMetadataCheck> {
  const cache = options.cache ?? sharedCache;
  const adapter = new DocumentMetadataAdapter();
  const resumes = latestResumes(documents);
  const files: FootprintMetadataCheck['files'][number][] = [];
  let checkedFiles = 0;
  for (const document of resumes) {
    let problems = cache.get(document.sha256);
    if (!problems) {
      const content = loadContent(document.id);
      if (content === null) continue;
      problems = await inspect(adapter, document, content);
      cache.set(document.sha256, problems);
    }
    checkedFiles += 1;
    if (problems.length) {
      files.push({ documentId: document.id, fileName: document.fileName, problems: [...problems] });
    }
  }
  const now = options.now ?? (() => new Date().toISOString());
  return { checkedAt: now(), checkedFiles, files };
}
