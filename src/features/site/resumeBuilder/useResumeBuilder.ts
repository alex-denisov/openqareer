import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EMPTY_BUILDER_RESUME,
  isBlankBuilderResume,
  SAMPLE_BUILDER_RESUME,
  type BuilderResume,
  type ResumeTemplate,
} from '../../../../shared/resumeBuilder/model';
import { assessBuilderResume } from '../../../../shared/resumeBuilder/ats';
import {
  downloadResumeFile,
  fetchVacancyKeywords,
  saveBuilderResumeToProfile,
  type VacancyKeywords,
} from './resumeBuilderApi';
import { readBuilderState, writeBuilderState, type ExportFormat } from './resumeBuilderStorage';
import type { BuilderStepId } from './BuilderSteps';

const KEYWORD_MESSAGES: Record<VacancyKeywords['outcome'], string | undefined> = {
  text: undefined,
  pool: undefined,
  unsupported_link: 'По этой ссылке вакансию не открыть. Вставьте текст вакансии.',
  not_in_pool: 'Этой вакансии нет в нашей базе. Вставьте текст вакансии.',
  no_keywords:
    'В тексте не нашлось требований. Вставьте текст вакансии целиком, с разделом «Требования».',
};

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

// One page model: the form, the preview, the ATS check and the files share this state.
// eslint-disable-next-line max-lines-per-function
export function useResumeBuilder(signedIn: boolean, onNavigate: (path: string) => void) {
  const [stored] = useState(() => readBuilderState());
  const startsFilled = Boolean(stored && !isBlankBuilderResume(stored.resume));
  const [editing, setEditing] = useState(startsFilled);
  const [resume, setResume] = useState<BuilderResume>(
    startsFilled && stored ? stored.resume : SAMPLE_BUILDER_RESUME,
  );
  const [template, setTemplate] = useState<ResumeTemplate>(stored?.template ?? 'strict');
  const [step, setStep] = useState<BuilderStepId>('contacts');
  const [vacancyInput, setVacancyInput] = useState('');
  const [keywords, setKeywords] = useState<VacancyKeywords>();
  const [keywordsBusy, setKeywordsBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<ExportFormat | 'upload'>();
  const pendingHandled = useRef(false);

  useEffect(() => {
    if (editing) writeBuilderState({ resume, template });
  }, [editing, resume, template]);

  const startBlank = useCallback(() => {
    setResume(EMPTY_BUILDER_RESUME);
    setEditing(true);
    setStep('contacts');
    setNotice(undefined);
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    setBusy('upload');
    setNotice(undefined);
    try {
      // The PDF reader is heavy; it loads only when a visitor brings a file.
      const { readResumeFile } = await import('./resumeFromFile');
      setResume(await readResumeFile(file));
      setEditing(true);
      setStep('contacts');
      setNotice(
        'Резюме прочитано. Проверьте поля: где не хватает месяца и года, проверка на ATS подскажет.',
      );
    } catch (reason) {
      setNotice(message(reason, 'Файл не прочитался. Загрузите PDF или DOCX либо заполните шаги.'));
    } finally {
      setBusy(undefined);
    }
  }, []);

  const checkVacancy = useCallback(async () => {
    if (!vacancyInput.trim()) return;
    setKeywordsBusy(true);
    try {
      setKeywords(await fetchVacancyKeywords(vacancyInput));
    } catch (reason) {
      setKeywords(undefined);
      setNotice(message(reason, 'Проверка не удалась. Вставьте текст вакансии.'));
    } finally {
      setKeywordsBusy(false);
    }
  }, [vacancyInput]);

  const download = useCallback(
    async (format: ExportFormat) => {
      const source = editing ? resume : SAMPLE_BUILDER_RESUME;
      if (!signedIn) {
        const saved = writeBuilderState({ resume: source, template, pendingExport: format });
        if (!saved) {
          setNotice(
            'Браузер не дал сохранить резюме перед регистрацией. Разрешите хранение данных сайта.',
          );
          return;
        }
        onNavigate(`/signup?from=resume&export=${format}`);
        return;
      }
      setBusy(format);
      setNotice(undefined);
      try {
        await downloadResumeFile(source, template, format);
      } catch (reason) {
        setNotice(message(reason, 'Не удалось собрать файл. Попробуйте ещё раз.'));
      } finally {
        setBusy(undefined);
      }
    },
    [editing, onNavigate, resume, signedIn, template],
  );

  // Back from sign-up: the profile gets the resume once, then the asked-for file downloads.
  useEffect(() => {
    if (!signedIn || pendingHandled.current || !stored?.pendingExport) return;
    pendingHandled.current = true;
    const format = stored.pendingExport;
    void (async () => {
      try {
        await saveBuilderResumeToProfile(stored.resume);
        writeBuilderState({ resume: stored.resume, template: stored.template });
        setNotice('Резюме сохранено в профиле, источник — «конструктор резюме».');
        await download(format);
      } catch (reason) {
        setNotice(
          message(reason, 'Резюме пока не сохранилось в профиле. Попробуйте скачать ещё раз.'),
        );
      }
    })();
  }, [download, signedIn, stored]);

  const keywordList = keywords && keywords.keywords.length ? keywords.keywords : undefined;
  return {
    editing,
    resume,
    setResume,
    template,
    setTemplate,
    step,
    setStep,
    startBlank,
    uploadFile,
    vacancyInput,
    setVacancyInput,
    checkVacancy,
    keywords,
    keywordsBusy,
    keywordsMessage: keywords ? KEYWORD_MESSAGES[keywords.outcome] : undefined,
    ats: assessBuilderResume(resume, keywordList),
    notice,
    busy,
    download,
  };
}

export type ResumeBuilderModel = ReturnType<typeof useResumeBuilder>;
