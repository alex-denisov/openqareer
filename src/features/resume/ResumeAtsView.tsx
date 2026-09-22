import { useState, useMemo } from 'react';
import { Check, Copy, DownloadSimple } from '@phosphor-icons/react';
import type { ResumeDocument, ResumeDraft } from './resumeTypes';
import {
  formatResumeAsAtsText,
  resumeExportFileName,
  triggerFileDownload,
} from './resumeExport';

export { formatResumeAsAtsText } from './resumeExport';

export interface ResumeAtsViewProps {
  readonly document: ResumeDocument;
  readonly draft: ResumeDraft;
}

function ResumeAtsActionBar({
  copied,
  onCopy,
  onDownload,
}: {
  readonly copied: boolean;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
}) {
  return (
    <div className="career-resume-ats-actions">
      <div className="career-resume-ats-info">
        <h3>ATS Plain Text</h3>
        <p>
          Моноширинный форматированный текст для корпоративных ATS (Workday, Taleo, Greenhouse, Lever, hh.ru).
        </p>
      </div>
      <div className="career-resume-ats-buttons">
        <button
          type="button"
          className="career-button is-compact career-resume-ats-copy-button"
          onClick={onCopy}
          aria-live="polite"
        >
          {copied ? (
            <>
              <Check size={14} aria-hidden />
              Скопировано
            </>
          ) : (
            <>
              <Copy size={14} aria-hidden />
              Копировать ATS-текст
            </>
          )}
        </button>
        <button
          type="button"
          className="career-button is-compact career-resume-ats-download-button"
          onClick={onDownload}
        >
          <DownloadSimple size={14} aria-hidden />
          Скачать .txt
        </button>
      </div>
    </div>
  );
}

export function ResumeAtsView({ document, draft }: ResumeAtsViewProps) {
  const [copied, setCopied] = useState(false);

  const atsText = useMemo(() => formatResumeAsAtsText(document, draft), [document, draft]);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(atsText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard error in unsupported environments
    }
  };

  const handleDownload = () => {
    const fileName = resumeExportFileName(document, 'txt');
    triggerFileDownload(fileName, atsText, 'text/plain;charset=utf-8');
  };

  return (
    <div className="career-resume-ats-view" aria-label="ATS Plain Text представление">
      <ResumeAtsActionBar copied={copied} onCopy={handleCopy} onDownload={handleDownload} />
      <div className="career-resume-ats-container">
        <pre className="career-resume-ats-pre">
          <code>{atsText}</code>
        </pre>
      </div>
    </div>
  );
}
