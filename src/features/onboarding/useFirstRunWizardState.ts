import { useState } from 'react';
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

export function useFirstRunWizardState(initialStep: FirstRunStep = 'source') {
  const [step, setStep] = useState<FirstRunStep>(initialStep);
  const [data, setData] = useState<FirstRunData>(DEFAULT_FIRST_RUN_DATA);
  const [isGoalEditing, setIsGoalEditing] = useState(false);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [isCitySheetOpen, setIsCitySheetOpen] = useState(false);
  const [isSkipDialogOpen, setIsSkipDialogOpen] = useState(false);
  const [isSkippedToastVisible, setIsSkippedToastVisible] = useState(false);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [turns, setTurns] = useState<readonly ConsultantTurn[]>(INITIAL_TURNS);

  const handleSendTurn = (text: string, isUser: boolean) =>
    setTurns((prev) => [...prev, { id: `t-${Date.now()}-${Math.random()}`, text, isUser }]);

  const handleConfirmSkip = () => {
    setData((prev) => skipSourceStep(prev));
    setIsSkipDialogOpen(false);
    setIsSkippedToastVisible(true);
    setStep('context');
  };

  const handleUndoSkip = () => {
    setData((prev) => restoreSourceStep(prev, 'linkedin'));
    setIsSkippedToastVisible(false);
    setStep('source');
  };

  return {
    step,
    setStep,
    data,
    setData,
    isGoalEditing,
    setIsGoalEditing,
    isSourceMenuOpen,
    setIsSourceMenuOpen,
    isCitySheetOpen,
    setIsCitySheetOpen,
    isSkipDialogOpen,
    setIsSkipDialogOpen,
    isSkippedToastVisible,
    isMobileChatOpen,
    setIsMobileChatOpen,
    turns,
    handleSendTurn,
    handleConfirmSkip,
    handleUndoSkip,
    handleSelectSource: (src: SourceType) => setData((p) => ({ ...p, selectedSource: src })),
    handleSelectCity: (city: FirstRunCity) => setData((p) => selectCity(p, city)),
    handleGoalChange: (val: string) => setData((p) => setGoal(p, val)),
    handleFormatChange: (fmt: WorkFormat) => setData((p) => setWorkFormat(p, fmt)),
    handleRelocationToggle: (rel: boolean) => setData((p) => setRelocationReady(p, rel)),
  };
}
