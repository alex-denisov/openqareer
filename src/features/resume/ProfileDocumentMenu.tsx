import { useMemo, useState } from 'react';
import { FileCode, FileText, Printer } from '@phosphor-icons/react';
import type { CandidateMemory } from '../coach/coachApi';
import { ResumeAtsView } from './ResumeAtsView';
import { ResumeDocumentView } from './ResumeDocumentView';
import { ResumeLinkedInPackView } from './ResumeLinkedInPackView';
import {
  exportResumeAsJson,
  formatResumeAsAtsText,
  resumeExportFileName,
  triggerFileDownload,
  triggerResumePrint,
} from './resumeExport';
import { FORMAT_LABELS } from './resumeLabels';
import { previewProjection, selectDocument } from './resumeStudioModel';
import type { ResumeDraft, ResumeFormatMode } from './resumeTypes';

const FORMATS: readonly ResumeFormatMode[] = ['stanford-pdf', 'ats-text', 'linkedin-pack'];

/**
 * "Документ и форматы" in the header — the place Resume Studio's PDF/ATS/JSON
 * export moved to (B265 §3c: not lost, not a second screen). Built from the
 * exact same engine and export helpers as Resume Studio, so the exported
 * bytes never disagree with what the studio itself produced.
 */
// eslint-disable-next-line max-lines-per-function
export function ProfileDocumentMenu({
  draft,
  memory,
}: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ResumeFormatMode>('stanford-pdf');
  const projection = useMemo(() => previewProjection(draft, memory), [draft, memory]);
  const document = useMemo(() => selectDocument(projection, 'master'), [projection]);

  if (!open) {
    return (
      <button type="button" className="career-quiet-button" onClick={() => setOpen(true)}>
        Документ и форматы
      </button>
    );
  }

  return (
    <div className="career-profile-document-menu">
      <div className="career-profile-document-menu-head">
        <div className="career-resume-formats" role="group" aria-label="Формат позиционирования">
          {FORMATS.map((mode) => (
            <button
              key={mode}
              type="button"
              className={format === mode ? 'is-active' : ''}
              aria-pressed={format === mode}
              onClick={() => setFormat(mode)}
            >
              {FORMAT_LABELS[mode]}
            </button>
          ))}
        </div>
        <div className="career-resume-export-group" role="group" aria-label="Экспорт резюме">
          {format === 'stanford-pdf' ? (
            <button type="button" className="career-resume-export-button" onClick={triggerResumePrint}>
              <Printer size={15} />
              Печать / PDF
            </button>
          ) : null}
          {format === 'ats-text' ? (
            <button
              type="button"
              className="career-resume-export-button"
              onClick={() => {
                const text = formatResumeAsAtsText(document, draft);
                triggerFileDownload(resumeExportFileName(document, 'txt'), text, 'text/plain;charset=utf-8');
              }}
            >
              <FileText size={15} />
              TXT (ATS)
            </button>
          ) : null}
          <button
            type="button"
            className="career-resume-export-button"
            onClick={() => {
              const json = exportResumeAsJson(document);
              triggerFileDownload(resumeExportFileName(document, 'json'), json, 'application/json;charset=utf-8');
            }}
          >
            <FileCode size={15} />
            JSON
          </button>
        </div>
        <button type="button" className="career-quiet-button" onClick={() => setOpen(false)}>
          Закрыть
        </button>
      </div>
      <div className="career-profile-document-preview">
        {format === 'stanford-pdf' ? <ResumeDocumentView draft={draft} document={document} evidence={[]} /> : null}
        {format === 'ats-text' ? <ResumeAtsView document={document} draft={draft} /> : null}
        {format === 'linkedin-pack' ? <ResumeLinkedInPackView document={document} draft={draft} /> : null}
      </div>
    </div>
  );
}
