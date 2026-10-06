import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, DownloadSimple, Printer } from '@phosphor-icons/react';
import { buildTargetedResumeSlice } from '../../../server/domain/resumeStudio';
import { pluralRu } from '../../../shared/pluralRu';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { estimateResumePages, type TargetedResumeVolume } from './targetedResumeVolume';
import type { ResumeDocument, ResumeDraft } from './resumeTypes';
import {
  formatResumeAsAtsText,
  formatTargetedResumeAsAtsText,
  resumeExportFileName,
  resumeTargetedExportFileName,
  saveResumeAsPdf,
  triggerFileDownload,
  triggerResumePrint,
} from './resumeExport';

export { formatResumeAsAtsText } from './resumeExport';

export interface ResumeAtsViewProps {
  readonly document: ResumeDocument;
  readonly draft: ResumeDraft;
}

interface GeneratedTarget {
  readonly source: ResumeDocument;
  readonly slice: TargetedResumeVolume;
}

function parseRequirementLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/^(?:[-*\u2022–]\s*)/u, '').trim())
    .filter(Boolean);
}

function useTargetedResume(master: ResumeDocument) {
  const [title, setTitle] = useState('');
  const [requirementsText, setRequirementsText] = useState('');
  const [generated, setGenerated] = useState<GeneratedTarget | null>(null);
  const [error, setError] = useState('');
  const requirements = useMemo(() => parseRequirementLines(requirementsText), [requirementsText]);
  const slice = generated?.source === master ? generated.slice : null;

  function clearTarget() {
    setGenerated(null);
    setError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (master.kind !== 'master') {
      setError('Целевой срез можно построить только из Мастер-резюме.');
      return;
    }
    if (requirements.length === 0) {
      setError('Добавьте хотя бы одно требование из вакансии.');
      return;
    }
    setGenerated({
      source: master,
      slice: estimateResumePages(buildTargetedResumeSlice(master, { title, requirements })),
    });
    setError('');
  }

  return {
    title,
    requirementsText,
    requirements,
    slice,
    error,
    setTitle: (value: string) => {
      setTitle(value);
      clearTarget();
    },
    setRequirementsText: (value: string) => {
      setRequirementsText(value);
      clearTarget();
    },
    submit,
    clearTarget,
  };
}

function useTargetedPdf(slice: TargetedResumeVolume | null) {
  const [message, setMessage] = useState('');
  useEffect(() => setMessage(''), [slice]);
  const print = useCallback(async () => {
    if (!slice) return;
    if (slice.pages > 2) {
      setMessage(slice.warning ?? `PDF не подготовлен: осталось ${slice.pages} стр.`);
      return;
    }
    document.body.dataset.resumePrintTarget = 'targeted';
    try {
      if (isTauriEnvironment()) {
        const path = await saveResumeAsPdf(
          resumeTargetedExportFileName(slice.document, 'pdf'),
        );
        setMessage(path ? `PDF сохранён: ${path}` : 'PDF не сохранён.');
        return;
      }
      const opened = await triggerResumePrint();
      setMessage(
        opened
          ? 'Окно печати открыто. Для PDF выберите «Сохранить в PDF».'
          : 'Печать отменена. PDF не сохранён.',
      );
    } catch {
      setMessage('Не удалось подготовить PDF. Попробуйте ещё раз.');
    } finally {
      delete document.body.dataset.resumePrintTarget;
    }
  }, [slice]);
  return { message, print };
}

function TargetedResumeButtons({
  disabled,
  onPrint,
  onReset,
}: {
  readonly disabled: boolean;
  readonly onPrint: () => void;
  readonly onReset: () => void;
}) {
  return (
    <>
      <button type="button" className="career-button is-compact" disabled={disabled} onClick={onPrint}>
        <Printer size={14} aria-hidden />
        Печать / PDF
      </button>
      <button type="button" className="career-button is-compact" onClick={onReset}>
        Показать мастер-резюме
      </button>
    </>
  );
}

function AtsCopyDownloadButtons({
  copied,
  targeted,
  onCopy,
  onDownload,
}: {
  readonly copied: boolean;
  readonly targeted: boolean;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
}) {
  return (
    <>
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
            {targeted ? 'Копировать целевой текст' : 'Копировать ATS-текст'}
          </>
        )}
      </button>
      <button
        type="button"
        className="career-button is-compact career-resume-ats-download-button"
        onClick={onDownload}
      >
        <DownloadSimple size={14} aria-hidden />
        {targeted ? 'Скачать целевой .txt' : 'Скачать .txt'}
      </button>
    </>
  );
}

function ResumeAtsActionBar(props: {
  readonly copied: boolean;
  readonly targeted: boolean;
  readonly printDisabled: boolean;
  readonly printMessage: string;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
  readonly onPrint: () => void;
  readonly onReset: () => void;
}) {
  const { copied, targeted, printDisabled, printMessage, onCopy, onDownload, onPrint, onReset } =
    props;
  return (
    <div className="career-resume-ats-actions">
      <div className="career-resume-ats-info">
        <h3>{targeted ? 'Целевое ATS-резюме' : 'ATS Plain Text'}</h3>
        <p>
          {targeted
            ? 'Срез содержит факты Мастер-резюме; требования без текстового совпадения помечены отдельно.'
            : 'Моноширинный форматированный текст для корпоративных ATS (Workday, Taleo, Greenhouse, Lever, hh.ru).'}
        </p>
      </div>
      <div className="career-resume-ats-buttons">
        {targeted ? (
          <TargetedResumeButtons
            disabled={printDisabled}
            onPrint={onPrint}
            onReset={onReset}
          />
        ) : null}
        <AtsCopyDownloadButtons
          copied={copied}
          targeted={targeted}
          onCopy={onCopy}
          onDownload={onDownload}
        />
      </div>
      {printMessage ? <p role="status">{printMessage}</p> : null}
    </div>
  );
}

function TargetedResumeTitleField({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="career-resume-field" htmlFor={id}>
      <span>Название вакансии</span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Например, инженер платформы"
      />
    </label>
  );
}

function TargetedResumeRequirementsField({
  id,
  hintId,
  errorId,
  value,
  error,
  onChange,
}: {
  readonly id: string;
  readonly hintId: string;
  readonly errorId: string;
  readonly value: string;
  readonly error: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <>
      <label className="career-resume-field" htmlFor={id}>
        <span>Требования вакансии</span>
        <textarea
          id={id}
          className="career-resume-linkedin-textarea"
          rows={5}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Kubernetes\nPostgreSQL\nУправление командой"
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          aria-invalid={Boolean(error)}
        />
      </label>
      <p id={hintId}>Вставьте по одному пункту в строке. Требование без совпадения останется видимым пробелом.</p>
      {error ? (
        <p id={errorId} className="career-resume-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function TargetedResumeForm(props: {
  readonly title: string;
  readonly requirementsText: string;
  readonly error: string;
  readonly onTitle: (value: string) => void;
  readonly onRequirements: (value: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { title, requirementsText, error, onTitle, onRequirements, onSubmit } = props;
  const id = useId();
  const titleId = `${id}-vacancy-title`;
  const requirementsId = `${id}-vacancy-requirements`;
  const hintId = `${id}-requirements-hint`;
  const errorId = `${id}-requirements-error`;
  return (
    <form className="career-resume-ats-targeting career-resume-ats-container" onSubmit={onSubmit}>
      <div className="career-resume-ats-info">
        <h3>Срез Мастер-резюме под вакансию</h3>
        <p>Совпадения ищутся по точным словам. Синонимы и новые факты не добавляются.</p>
      </div>
      <TargetedResumeTitleField id={titleId} value={title} onChange={onTitle} />
      <TargetedResumeRequirementsField
        id={requirementsId}
        hintId={hintId}
        errorId={errorId}
        value={requirementsText}
        error={error}
        onChange={onRequirements}
      />
      <div className="career-resume-ats-buttons">
        <button type="submit" className="career-button is-compact">
          Собрать целевое резюме
        </button>
      </div>
    </form>
  );
}

function TargetedResumeSummary({ slice }: { readonly slice: TargetedResumeVolume }) {
  const id = useId();
  const detailedIds = new Set(slice.detailedExperienceIds);
  return (
    <section className="career-resume-ats-container" aria-labelledby={`${id}-summary`}>
      <h3 id={`${id}-summary`}>Что выделено в срезе</h3>
      <p>
        Текстовые совпадения: {slice.matchedRequirements.length} из {slice.requirements.length}.
        {' '}Ориентировочный объём: {slice.pages} стр.
      </p>
      <ul>
        {slice.document.experience.map((role) => {
          const heading = [role.title?.value, role.employer?.value].filter(Boolean).join(' — ');
          return (
            <li key={role.id}>
              <strong>{heading || 'Роль без названия'}</strong>
              {detailedIds.has(role.id) ? ' — подробности сохранены' : ' — оставлены роль и даты'}
            </li>
          );
        })}
        {(slice.document.projects ?? []).map((project) => (
          <li key={project.id}>
            <strong>{project.name.value}</strong> — проект выделен по требованиям
          </li>
        ))}
      </ul>
      {slice.trimmed.length > 0 ? (
        <TrimmedItems items={slice.trimmed} />
      ) : null}
      {slice.missingRequirements.length > 0 ? (
        <div>
          <h4>Требования без совпадения в тексте Мастер-резюме</h4>
          <ul>
            {slice.missingRequirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {slice.warning ? <p className="career-resume-error" role="alert">{slice.warning}</p> : null}
    </section>
  );
}

function TrimmedItems({ items }: { readonly items: TargetedResumeVolume['trimmed'] }) {
  return (
    <>
      <p>{trimmedSummary(items.length)}</p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.label}</strong> — {item.reason}
          </li>
        ))}
      </ul>
    </>
  );
}

function trimmedSummary(count: number): string {
  if (count === 1) return 'Убран 1 пункт, который не относится к вакансии.';
  return `Убрано ${pluralRu(count, ['пункт', 'пункта', 'пунктов'])}, не относящихся к вакансии.`;
}

type TargetingState = ReturnType<typeof useTargetedResume>;

function useAtsText(
  document: ResumeDocument,
  draft: ResumeDraft,
  slice: TargetedResumeVolume | null,
): string {
  return useMemo(
    () => (slice ? formatTargetedResumeAsAtsText(slice) : formatResumeAsAtsText(document, draft)),
    [document, draft, slice],
  );
}

function useAtsActions(
  document: ResumeDocument,
  slice: TargetedResumeVolume | null,
  text: string,
) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [text]);
  const copy = () => void copyAtsText(text, setCopied);
  const download = () => {
    const name = slice
      ? resumeTargetedExportFileName(slice.document, 'txt')
      : resumeExportFileName(document, 'txt');
    triggerFileDownload(name, text, 'text/plain;charset=utf-8');
  };
  return { copied, copy, download };
}

async function copyAtsText(text: string, onCopied: (copied: boolean) => void): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(text);
    onCopied(true);
    setTimeout(() => onCopied(false), 2000);
  } catch {
    // Ignore clipboard error in unsupported environments
  }
}

function TargetedResumePrintDocument({
  slice,
  text,
}: {
  readonly slice: TargetedResumeVolume | null;
  readonly text: string;
}) {
  if (!slice || typeof window === 'undefined') return null;
  const printHost = window.document.querySelector('.career-shell') ?? window.document.body;
  return createPortal(
    <article className="career-resume-print career-resume-print-targeted" aria-hidden="true">
      <pre className="career-resume-ats-pre">
        <code>{text}</code>
      </pre>
    </article>,
    printHost,
  );
}

function ResumeAtsContent({
  document,
  draft,
  targeting,
}: ResumeAtsViewProps & { readonly targeting: TargetingState }) {
  const { message: printMessage, print } = useTargetedPdf(targeting.slice);
  const atsText = useAtsText(document, draft, targeting.slice);
  const { copied, copy, download } = useAtsActions(document, targeting.slice, atsText);
  return (
    <>
      <div className="career-resume-ats-view" aria-label="ATS Plain Text представление">
        <TargetedResumeForm
          title={targeting.title}
          requirementsText={targeting.requirementsText}
          error={targeting.error}
          onTitle={targeting.setTitle}
          onRequirements={targeting.setRequirementsText}
          onSubmit={targeting.submit}
        />
        {targeting.slice ? <TargetedResumeSummary slice={targeting.slice} /> : null}
        <ResumeAtsActionBar
          copied={copied}
          targeted={Boolean(targeting.slice)}
          printDisabled={!targeting.slice || targeting.slice.pages > 2}
          printMessage={printMessage}
          onCopy={copy}
          onDownload={download}
          onPrint={() => void print()}
          onReset={targeting.clearTarget}
        />
        <div className="career-resume-ats-container">
          <pre className="career-resume-ats-pre">
            <code>{atsText}</code>
          </pre>
        </div>
      </div>
      <TargetedResumePrintDocument slice={targeting.slice} text={atsText} />
    </>
  );
}

export function ResumeAtsView({ document, draft }: ResumeAtsViewProps) {
  const targeting = useTargetedResume(document);
  return <ResumeAtsContent document={document} draft={draft} targeting={targeting} />;
}
