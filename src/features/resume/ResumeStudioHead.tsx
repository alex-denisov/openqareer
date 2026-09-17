import { FloppyDisk, Printer, FileText, FileCode } from '@phosphor-icons/react';
import { FORMAT_LABELS, VARIANT_LABELS, VARIANT_SHORT_LABELS } from './resumeLabels';
import type { ResumeStatusSummary } from './resumeStudioModel';
import type {
  ResumeDocument,
  ResumeFormatMode,
  ResumeStudioView,
  ResumeVariantId,
} from './resumeTypes';
import {
  exportResumeAsPlainText,
  exportResumeAsJson,
  resumeExportFileName,
  triggerFileDownload,
  triggerResumePrint,
} from './resumeExport';

interface ResumeStudioHeadProps {
  readonly variant: ResumeVariantId;
  readonly variants: readonly ResumeVariantId[];
  readonly format?: ResumeFormatMode;
  readonly summary: ResumeStatusSummary;
  readonly savedAt: ResumeStudioView['savedAt'];
  readonly saving: boolean;
  readonly saveError?: string;
  readonly unknownCount: number;
  readonly dossierCount?: number;
  readonly activePane: 'dossier' | 'document' | 'unknowns';
  readonly document?: ResumeDocument;
  readonly onVariant: (variant: ResumeVariantId) => void;
  readonly onFormat?: (format: ResumeFormatMode) => void;
  readonly onPane: (pane: 'dossier' | 'document') => void;
  readonly onSave?: () => void;
}

/**
 * On a phone only the first screen is reliably read, so the header carries the
 * whole decision: how long the document is, what blocks it, and what to do next.
 */
function ResumeSaveStatus({
  savedAt,
  saveError,
}: {
  readonly savedAt?: ResumeStudioView['savedAt'];
  readonly saveError?: string;
}) {
  return (
    <>
      <p className="career-resume-saved">
        {savedAt
          ? `Черновик сохранён ${formatMoment(savedAt.updatedAt)}. Сохранение фиксирует список доказательств.`
          : 'Черновик ещё не сохранён. Сохранение фиксирует список доказательств, на которые вы опираетесь.'}
      </p>
      {saveError ? (
        <p className="career-resume-error" role="alert">
          {saveError}
        </p>
      ) : null}
    </>
  );
}

export function ResumeStudioHead(props: ResumeStudioHeadProps) {
  const {
    variant,
    variants,
    format = 'stanford-pdf',
    summary,
    savedAt,
    saving,
    saveError,
    unknownCount,
    dossierCount = unknownCount,
    activePane,
    document,
    onVariant,
    onFormat,
    onPane,
    onSave,
  } = props;

  return (
    <header className="career-resume-head">
      <div className="career-resume-head-title">
        <span className="career-cabinet-kicker">Resume Studio</span>
        <h2>{VARIANT_LABELS[variant]}</h2>
      </div>

      <StatusStrip summary={summary} />

      <div className="career-resume-actions">
        {onFormat ? <FormatSwitch format={format} onFormat={onFormat} /> : null}
        <VariantSwitch variant={variant} variants={variants} onVariant={onVariant} />
        {document ? <ResumeExportActions document={document} /> : null}
        {onSave ? (
          <button
            className="career-primary-button"
            type="button"
            disabled={saving}
            onClick={onSave}
          >
            <FloppyDisk size={16} />
            {saving ? 'Сохраняем…' : 'Сохранить и зафиксировать факты'}
          </button>
        ) : null}
      </div>

      <ResumeSaveStatus savedAt={savedAt} saveError={saveError} />

      <PaneSwitch activePane={activePane} dossierCount={dossierCount} onPane={onPane} />
    </header>
  );
}

function FormatSwitch({
  format,
  onFormat,
}: {
  format: ResumeFormatMode;
  onFormat: (format: ResumeFormatMode) => void;
}) {
  const formats: readonly ResumeFormatMode[] = ['stanford-pdf', 'ats-text', 'linkedin-pack'];
  return (
    <div className="career-resume-formats" role="group" aria-label="Формат позиционирования">
      {formats.map((mode) => (
        <button
          key={mode}
          type="button"
          className={format === mode ? 'is-active' : ''}
          aria-pressed={format === mode}
          onClick={() => onFormat(mode)}
        >
          {FORMAT_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}

function VariantSwitch({
  variant,
  variants,
  onVariant,
}: {
  variant: ResumeVariantId;
  variants: readonly ResumeVariantId[];
  onVariant: (variant: ResumeVariantId) => void;
}) {
  // One variant is not a choice; a switch with a single button would imply
  // there is somewhere else to go.
  if (variants.length < 2) return null;
  return (
    <div className="career-resume-variants" role="group" aria-label="Вариант резюме">
      {variants.map((id) => (
        <button
          key={id}
          type="button"
          className={variant === id ? 'is-active' : ''}
          aria-pressed={variant === id}
          onClick={() => onVariant(id)}
        >
          {VARIANT_SHORT_LABELS[id]}
        </button>
      ))}
    </div>
  );
}

function PaneSwitch({
  activePane,
  dossierCount,
  onPane,
}: {
  activePane: 'dossier' | 'document' | 'unknowns';
  dossierCount: number;
  onPane: (pane: 'dossier' | 'document') => void;
}) {
  const isDossier = activePane === 'dossier' || activePane === 'unknowns';
  return (
    <div className="career-resume-panes" role="group" aria-label="Что показать">
      <button
        type="button"
        className={isDossier ? 'is-active' : ''}
        aria-pressed={isDossier}
        onClick={() => onPane('dossier')}
      >
        Факты ({dossierCount})
      </button>
      <button
        type="button"
        className={activePane === 'document' ? 'is-active' : ''}
        aria-pressed={activePane === 'document'}
        onClick={() => onPane('document')}
      >
        Документ и форматы
      </button>
    </div>
  );
}

function StatusStrip({ summary }: { summary: ResumeStatusSummary }) {
  return (
    <dl className={`career-resume-status is-${summary.tone}`}>
      <div>
        <dt>Объём, стр.</dt>
        <dd>
          {summary.pages}
          {summary.maxPages ? ` / ${summary.maxPages}` : ''}
        </dd>
      </div>
      <div>
        <dt>Блокирует</dt>
        <dd>{summary.blocking}</dd>
      </div>
      <div>
        <dt>Уточнить</dt>
        <dd>{summary.open}</dd>
      </div>
      <div>
        <dt>Отозвано</dt>
        <dd>{summary.staleEvidence}</dd>
      </div>
    </dl>
  );
}

function formatMoment(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function ResumeExportActions({ document }: { readonly document: ResumeDocument }) {
  const handleExportText = () => {
    const text = exportResumeAsPlainText(document);
    const fileName = resumeExportFileName(document, 'txt');
    triggerFileDownload(fileName, text, 'text/plain;charset=utf-8');
  };

  const handleExportJson = () => {
    const json = exportResumeAsJson(document);
    const fileName = resumeExportFileName(document, 'json');
    triggerFileDownload(fileName, json, 'application/json;charset=utf-8');
  };

  return (
    <div className="career-resume-export-group" role="group" aria-label="Экспорт резюме">
      <button
        type="button"
        className="career-resume-export-button"
        onClick={handleExportText}
        title="Скачать резюме в текстовом формате для ATS"
      >
        <FileText size={15} />
        TXT (ATS)
      </button>
      <button
        type="button"
        className="career-resume-export-button"
        onClick={triggerResumePrint}
        title="Распечатать или сохранить в PDF"
      >
        <Printer size={15} />
        Печать / PDF
      </button>
      <button
        type="button"
        className="career-resume-export-button"
        onClick={handleExportJson}
        title="Скачать структурированные данные резюме в JSON"
      >
        <FileCode size={15} />
        JSON
      </button>
    </div>
  );
}

