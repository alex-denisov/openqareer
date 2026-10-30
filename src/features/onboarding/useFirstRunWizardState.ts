import { useEffect, useState } from 'react';
import type { ResumeIngestionState } from '../journey/useResumeIngestion';
import {
  initialFirstRunData,
  readSessionGoal,
  restoreSourceStep,
  selectCity,
  setGoal,
  setRelocationReady,
  setWorkFormat,
  skipSourceStep,
} from './firstRunStorage';
import type {
  FirstRunCity,
  FirstRunData,
  FirstRunStep,
  SourceType,
  WorkFormat,
} from './firstRunTypes';

export interface UploadedFileInfo {
  readonly name: string;
  readonly size?: number;
}

function useFirstRunDialogState() {
  const [isGoalEditing, setIsGoalEditing] = useState(false);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [isCitySheetOpen, setIsCitySheetOpen] = useState(false);
  const [isSkipDialogOpen, setIsSkipDialogOpen] = useState(false);
  const [isSkippedToastVisible, setIsSkippedToastVisible] = useState(false);
  useEffect(() => {
    if (!isSkippedToastVisible) return;
    const timer = window.setTimeout(() => setIsSkippedToastVisible(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [isSkippedToastVisible]);

  return {
    isGoalEditing,
    setIsGoalEditing,
    isSourceMenuOpen,
    setIsSourceMenuOpen,
    isCitySheetOpen,
    setIsCitySheetOpen,
    isSkipDialogOpen,
    setIsSkipDialogOpen,
    isSkippedToastVisible,
    setIsSkippedToastVisible,
  };
}

function uploadStatus(result?: Awaited<ReturnType<ResumeIngestionState['readPdf']>>): string {
  if (!result) return 'Не удалось прочитать PDF. Проверьте файл или продолжите без него.';
  if (result.imported) return 'Резюме прочитано и сохранено в профиле.';
  if (result.storeFailure) return 'Резюме прочитано, но пока не сохранено в профиле.';
  return 'Резюме прочитано и подготовлено локально; в профиль на сервере оно не сохранено.';
}

function useFirstRunFileUpload(setData: React.Dispatch<React.SetStateAction<FirstRunData>>) {
  const [uploadedFile, setUploadedFile] = useState<UploadedFileInfo | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionError, setIngestionError] = useState<string | null>(null);
  const [ingestionNotice, setIngestionNotice] = useState<string | null>(null);

  const handleFileUpload = async (file: File, ingestion?: ResumeIngestionState) => {
    setIsIngesting(true);
    setIngestionError(null);
    setIngestionNotice(null);
    setUploadedFile({ name: file.name, size: file.size });
    setData((current) => ({ ...current, selectedSource: 'file' }));
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error('Файл больше 10 МБ. Выберите PDF или DOCX меньшего размера.');
      const result = await ingestion?.readPdf(file);
      if (result) setIngestionNotice(uploadStatus(result));
      else setIngestionError(uploadStatus());
    } catch (error) {
      setIngestionError(
        error instanceof Error
          ? error.message
          : 'Не удалось прочитать PDF. Попробуйте другой файл.',
      );
    } finally {
      setIsIngesting(false);
    }
  };

  return { uploadedFile, isIngesting, ingestionError, ingestionNotice, handleFileUpload };
}

export function useFirstRunWizardState(initialStep: FirstRunStep = 'source') {
  // Цель уже сохранена в этой вкладке: после перезагрузки мастер продолжает с шага 2.
  const [step, setStep] = useState<FirstRunStep>(() =>
    initialStep === 'goal' && readSessionGoal() ? 'source' : initialStep,
  );
  const [data, setData] = useState<FirstRunData>(initialFirstRunData);
  const dialogs = useFirstRunDialogState();
  const upload = useFirstRunFileUpload(setData);

  const handleConfirmSkip = () => {
    setData((current) => skipSourceStep(current));
    dialogs.setIsSkipDialogOpen(false);
    dialogs.setIsSkippedToastVisible(true);
    setStep('context');
  };

  /** «Рассказать консультанту»: путь без источника ведёт сразу на шаг 3 (B538). */
  const handleChooseTalk = () => {
    setData((current) => skipSourceStep(current));
    setStep('context');
  };

  const handleUndoSkip = () => {
    setData((current) => restoreSourceStep(current, 'linkedin'));
    dialogs.setIsSkippedToastVisible(false);
    setStep('source');
  };

  return {
    step,
    setStep,
    data,
    setData,
    ...dialogs,
    handleConfirmSkip,
    handleChooseTalk,
    handleUndoSkip,
    ...upload,
    handleSelectSource: (source: SourceType) =>
      setData((current) => ({ ...current, selectedSource: source })),
    handleSelectCity: (city: FirstRunCity) => {
      setData((current) => selectCity(current, city));
      dialogs.setIsSkippedToastVisible(false);
    },
    handleGoalChange: (goal: string) => setData((current) => setGoal(current, goal)),
    handleFormatChange: (format: WorkFormat) =>
      setData((current) => setWorkFormat(current, format)),
    handleRelocationToggle: (ready: boolean) =>
      setData((current) => setRelocationReady(current, ready)),
  };
}
