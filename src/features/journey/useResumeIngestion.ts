import { useCallback, useState } from 'react';
import {
  importCandidateResume,
  type NativeSourceReceipt,
  type NativeSourceConnection,
  type ResumeImportSource,
} from '../resume/resumeApi';
import type { ResumeDraft } from '../resume/resumeTypes';
import { extractPdfResume } from '../workspace/pdfResume';
import {
  parseResumeContent,
  parsedResumeToDraft,
  type ParsedResume,
} from '../workspace/resumeParser';
import type { ResumeSource } from '../workspace/workspaceStorage';

export interface IngestedResume {
  readonly parsed: ParsedResume;
  readonly draft: ResumeDraft;
  readonly text: string;
  readonly source: ResumeSource;
  readonly file?: { readonly name: string; readonly pages: number };
  /** True once the document has reached the candidate-scoped resume API. */
  readonly imported: boolean;
  readonly factCount?: number;
  readonly sourceReceipt?: NativeSourceReceipt;
  readonly connection?: NativeSourceConnection;
}

export interface ResumeIngestionState {
  readonly result?: IngestedResume;
  readonly busy: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly readPdf: (file: File) => Promise<void>;
  readonly acceptParsed: (
    parsed: ParsedResume,
    source: ResumeSource,
    sourceReceipt?: NativeSourceReceipt,
  ) => Promise<IngestedResume>;
  readonly clear: () => void;
  readonly setError: (message?: string) => void;
}

const IMPORT_SOURCE: Record<ResumeSource, ResumeImportSource> = {
  pdf: 'pdf',
  'linkedin-pdf': 'linkedin',
  'hh-pdf': 'hh',
  text: 'text',
};

/**
 * Reading a document and putting it into the candidate's dossier is one act.
 *
 * The wizard used to parse locally, hand the draft to `App`, and let a
 * fire-and-forget `PUT` fail in silence — the candidate saw «резюме
 * распарсено» and then an empty Resume Studio (B148 §3b). Here the import runs
 * where the candidate is looking, its refusal is shown, and the counts on
 * screen are the counts the server actually stored.
 */
// One hook, one state machine: the three entry points share every setter.
// eslint-disable-next-line max-lines-per-function
export function useResumeIngestion(hasAccount: boolean): ResumeIngestionState {
  const [result, setResult] = useState<IngestedResume>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const ingest = useCallback(
    // One transaction-shaped state transition; splitting setters would make partial UI state possible.
    // eslint-disable-next-line max-lines-per-function
    async (
      text: string,
      source: ResumeSource,
      localParsed: ParsedResume,
      file?: { name: string; pages: number },
      sourceReceipt?: NativeSourceReceipt,
    ): Promise<IngestedResume> => {
      if (!hasAccount) {
        const local = {
          parsed: localParsed,
          draft: parsedResumeToDraft(localParsed),
          text,
          source,
          file,
          imported: false,
          sourceReceipt,
        } satisfies IngestedResume;
        setResult(local);
        return local;
      }
      try {
        const imported = await importCandidateResume(
          source === 'hh-pdf' || source === 'linkedin-pdf'
            ? {
                text,
                source: source === 'hh-pdf' ? 'hh' : 'linkedin',
                fileName: file?.name,
                sourceReceipt,
              }
            : {
                text,
                source: IMPORT_SOURCE[source],
                fileName: file?.name,
              },
        );
        if (sourceReceipt && !imported.connection) {
          throw new Error('native_connection_receipt_missing');
        }
        const stored = {
          parsed: imported.parsed,
          draft: parsedResumeToDraft(imported.parsed),
          text,
          source,
          file,
          imported: true,
          factCount: imported.factCount,
          sourceReceipt,
          connection: imported.connection,
        } satisfies IngestedResume;
        setResult(stored);
        setNotice(undefined);
        return stored;
      } catch (reason) {
        // The candidate keeps the local reading and the wizard keeps moving;
        // the sentence says plainly that the profile was not stored yet.
        const local = {
          parsed: localParsed,
          draft: parsedResumeToDraft(localParsed),
          text,
          source,
          file,
          imported: false,
          sourceReceipt,
        } satisfies IngestedResume;
        setResult(local);
        setNotice(
          `Резюме прочитано, но пока не сохранено в профиль: ${message(reason)} Мы повторим сохранение в конце диагностики.`,
        );
        return local;
      }
    },
    [hasAccount],
  );

  const readPdf = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(undefined);
      setNotice(undefined);
      try {
        const extracted = await extractPdfResume(file);
        await ingest(extracted.text, 'pdf', parseResumeContent(extracted.text), {
          name: extracted.fileName,
          pages: extracted.pageCount,
        });
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Прочитать PDF не удалось. Можно продолжить без файла.',
        );
      } finally {
        setBusy(false);
      }
    },
    [ingest],
  );

  const acceptParsed = useCallback(
    async (
      parsed: ParsedResume,
      source: ResumeSource,
      sourceReceipt?: NativeSourceReceipt,
    ) => {
      setBusy(true);
      setError(undefined);
      try {
        return await ingest(parsed.rawText, source, parsed, undefined, sourceReceipt);
      } finally {
        setBusy(false);
      }
    },
    [ingest],
  );

  return {
    result,
    busy,
    error,
    notice,
    readPdf,
    acceptParsed,
    clear: useCallback(() => {
      setResult(undefined);
      setError(undefined);
      setNotice(undefined);
    }, []),
    setError,
  };
}

function message(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : '';
  return text.endsWith('.') || text.endsWith('!') ? text : `${text || 'сервис не ответил'}.`;
}
