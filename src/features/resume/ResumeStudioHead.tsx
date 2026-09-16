import { FloppyDisk, Printer, FileText, FileCode } from '@phosphor-icons/react';
import { VARIANT_LABELS, VARIANT_SHORT_LABELS } from './resumeLabels';
import type { ResumeStatusSummary } from './resumeStudioModel';
import type { ResumeDocument, ResumeStudioView, ResumeVariantId } from './resumeTypes';
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
  readonly summary: ResumeStatusSummary;
  readonly savedAt: ResumeStudioView['savedAt'];
  readonly saving: boolean;
  readonly saveError?: string;
  readonly unknownCount: number;
  readonly activePane: 'unknowns' | 'document';
  readonly document?: ResumeDocument;
  readonly onVariant: (variant: ResumeVariantId) => void;
  readonly onPane: (pane: 'unknowns' | 'document') => void;
  readonly onSave?: () => void;
}

/**
 * On a phone only the first screen is reliably read, so the header carries the
 * whole decision: how long the document is, what blocks it, and what to do next.
 */
export function ResumeStudioHead({
  variant,
  variants,
  summary,
  savedAt,
  saving,
  saveError,
  unknownCount,
  activePane,
  document,
  onVariant,
  onPane,
  onSave,
}: ResumeStudioHeadProps) {
  return (
    <header className="career-resume-head">
      <div className="career-resume-head-title">
        <span className="career-cabinet-kicker">Resume Studio</span>
        <h2>{VARIANT_LABELS[variant]}</h2>
      </div>

      <StatusStrip summary={summary} />

      <div className="career-resume-actions">
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

      <PaneSwitch activePane={activePane} unknownCount={unknownCount} onPane={onPane} />
    </header>
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
  unknownCount,
  onPane,
}: {
  activePane: 'unknowns' | 'document';
  unknownCount: number;
  onPane: (pane: 'unknowns' | 'document') => void;
}) {
  return (
    <div className="career-resume-panes" role="group" aria-label="Что показать">
      <button
        type="button"
        className={activePane === 'unknowns' ? 'is-active' : ''}
        aria-pressed={activePane === 'unknowns'}
        onClick={() => onPane('unknowns')}
      >
        Уточнить ({unknownCount})
      </button>
      <button
        type="button"
        className={activePane === 'document' ? 'is-active' : ''}
        aria-pressed={activePane === 'document'}
        onClick={() => onPane('document')}
      >
        Документ
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

