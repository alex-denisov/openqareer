import { useState } from 'react';
import type { ResumeIngestionState } from '../journey/useResumeIngestion';
import {
  DEFAULT_FIRST_RUN_DATA,
  restoreSourceStep,
  selectCity,
  setGoal,
  setRelocationReady,
  setWorkFormat,
  skipSourceStep,
} from './firstRunStorage';
import type {
  ConsultantTurn,
  FirstRunCity,
  FirstRunData,
  FirstRunStep,
  SourceType,
  WorkFormat,
} from './firstRunTypes';

const INITIAL_TURNS: readonly ConsultantTurn[] = [
  {
    id: 't-1',
    text: 'Начнём с источника. Подключите LinkedIn или hh.ru, загрузите резюме или просто расскажите, чем занимаетесь.',
    isUser: false,
  },
];

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
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);

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
    isMobileChatOpen,
    setIsMobileChatOpen,
  };
}

function useFirstRunFileUpload(
  setData: React.Dispatch<React.SetStateAction<FirstRunData>>,
  handleSendTurn: (text: string, isUser: boolean) => void,
) {
  const [uploadedFile, setUploadedFile] = useState<UploadedFileInfo | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionError, setIngestionError] = useState<string | null>(null);

  const handleFileUpload = async (file: File, ingestion?: ResumeIngestionState) => {
    setIsIngesting(true);
    setIngestionError(null);
    setUploadedFile({ name: file.name, size: file.size });
    setData((p) => ({ ...p, selectedSource: 'file' }));
    handleSendTurn(`Загружен файл: ${file.name}`, true);

    try {
      if (ingestion) {
        await ingestion.readPdf(file);
        if (ingestion.error) {
          setIngestionError(ingestion.error);
        }
      }
      handleSendTurn(`Файл «${file.name}» прочитан: опыт готов к формированию профиля.`, false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось прочитать файл';
      setIngestionError(msg);
    } finally {
      setIsIngesting(false);
    }
  };

  return { uploadedFile, isIngesting, ingestionError, handleFileUpload };
}

export function useFirstRunWizardState(initialStep: FirstRunStep = 'source') {
  const [step, setStep] = useState<FirstRunStep>(initialStep);
  const [data, setData] = useState<FirstRunData>(DEFAULT_FIRST_RUN_DATA);
  const [turns, setTurns] = useState<readonly ConsultantTurn[]>(INITIAL_TURNS);
  const dialogs = useFirstRunDialogState();

  const handleSendTurn = (text: string, isUser: boolean) =>
    setTurns((prev) => [...prev, { id: `t-${Date.now()}-${Math.random()}`, text, isUser }]);

  const upload = useFirstRunFileUpload(setData, handleSendTurn);

  const handleConfirmSkip = () => {
    setData((prev) => skipSourceStep(prev));
    dialogs.setIsSkipDialogOpen(false);
    dialogs.setIsSkippedToastVisible(true);
    setStep('context');
  };

  const handleUndoSkip = () => {
    setData((prev) => restoreSourceStep(prev, 'linkedin'));
    dialogs.setIsSkippedToastVisible(false);
    setStep('source');
  };

  return {
    step,
    setStep,
    data,
    setData,
    ...dialogs,
    turns,
    handleSendTurn,
    handleConfirmSkip,
    handleUndoSkip,
    ...upload,
    handleSelectSource: (src: SourceType) => setData((p) => ({ ...p, selectedSource: src })),
    handleSelectCity: (city: FirstRunCity) => setData((p) => selectCity(p, city)),
    handleGoalChange: (val: string) => setData((p) => setGoal(p, val)),
    handleFormatChange: (fmt: WorkFormat) => setData((p) => setWorkFormat(p, fmt)),
    handleRelocationToggle: (rel: boolean) => setData((p) => setRelocationReady(p, rel)),
  };
}
