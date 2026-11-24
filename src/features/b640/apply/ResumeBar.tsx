import { useEffect, useId, useRef, useState } from 'react';
import {
  RESUME_TEMPLATE_LABELS,
  RESUME_TEMPLATES,
  type BuilderResume,
  type ResumeTemplate,
} from '../../../../shared/resumeBuilder/model';
import type { ResumeLang } from '../../../../shared/resumeVacancyEdits';
import { downloadResumeFile } from '../../site/resumeBuilder/resumeBuilderApi';
import type { ExportFormat } from '../../site/resumeBuilder/resumeBuilderStorage';
import { Icon, useToast } from '../kit';

const FORMATS: readonly { readonly id: ExportFormat; readonly label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'DOCX' },
];
const FAILED = 'Не удалось собрать файл. Попробуйте ещё раз.';

/** Меню закрывается по Esc (фокус возвращается на кнопку) и по нажатию вне его. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return { open, setOpen, root, button };
}

const LANGS: ReadonlyArray<{
  readonly id: ResumeLang;
  readonly full: string;
  readonly short: string;
}> = [
  { id: 'ru', full: 'Русский', short: 'RU' },
  { id: 'en', full: 'English', short: 'EN' },
];

export interface ResumeLangControl {
  readonly value: ResumeLang;
  readonly busy: boolean;
  readonly onChange: (lang: ResumeLang) => void;
}

function LangSwitch({ value, busy, onChange }: ResumeLangControl) {
  return (
    <div className="seg cv-lang-seg" role="group" aria-label="Язык резюме" aria-busy={busy}>
      {LANGS.map((item) => (
        <button
          key={item.id}
          className="seg-i"
          type="button"
          aria-pressed={item.id === value}
          aria-label={item.full}
          disabled={busy}
          onClick={() => {
            if (item.id !== value) onChange(item.id);
          }}
        >
          <span className="cv-l-full">{item.full}</span>
          <span className="cv-l-short" aria-hidden="true">
            {item.short}
          </span>
        </button>
      ))}
    </div>
  );
}

interface Props {
  readonly resume: BuilderResume;
  readonly template: ResumeTemplate;
  readonly onTemplate: (template: ResumeTemplate) => void;
  /** Язык меняется у резюме под вакансию до одобрения. */
  readonly lang: ResumeLangControl | null;
}

function DownloadMenu({ resume, template }: Omit<Props, 'onTemplate' | 'lang'>) {
  const id = useId();
  const toast = useToast();
  const { open, setOpen, root, button } = useMenu();
  const [busy, setBusy] = useState(false);

  async function download(format: ExportFormat) {
    setOpen(false);
    button.current?.focus();
    setBusy(true);
    try {
      await downloadResumeFile(resume, template, format);
    } catch (reason) {
      toast.show({ text: reason instanceof Error ? reason.message : FAILED });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lk-menu cv-dl" ref={root}>
      <button
        ref={button}
        className="icon-btn"
        type="button"
        aria-label="Скачать"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-busy={busy}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="download" />
      </button>
      <ul className="lk-menu-l" id={id} role="menu" aria-label="Скачать" hidden={!open}>
        {FORMATS.map((item) => (
          <li role="none" key={item.id}>
            <button role="menuitem" type="button" onClick={() => void download(item.id)}>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Параметры файла (макет o03): шаблон и скачивание. */
export function ResumeBar({ resume, template, onTemplate, lang }: Props) {
  const id = useId();
  return (
    <div className="cv-bar" role="group" aria-label="Параметры файла">
      <div className="cv-tpl">
        <label className="vh" htmlFor={id}>
          Шаблон резюме
        </label>
        <select
          id={id}
          value={template}
          onChange={(event) => onTemplate(event.currentTarget.value as ResumeTemplate)}
        >
          {RESUME_TEMPLATES.map((item) => (
            <option key={item} value={item}>{`Шаблон: ${RESUME_TEMPLATE_LABELS[item]}`}</option>
          ))}
        </select>
      </div>
      {lang ? <LangSwitch {...lang} /> : null}
      <DownloadMenu resume={resume} template={template} />
    </div>
  );
}
