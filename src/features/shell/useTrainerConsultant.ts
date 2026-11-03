import { useEffect, useState } from 'react';
import { useTrainerScreenOpen } from '../journey/consultantScreenSuggestion';

/**
 * Макет 14: на 1440 у тренажёра нет колонки консультанта. Пока он открыт, колонка спрятана,
 * а в шапке появляется значок консультанта; по нему панель ложится поверх тренажёра.
 */
export function useTrainerConsultant(expertPanelVisible: boolean, isCompactViewport: boolean) {
  const trainerOpen = useTrainerScreenOpen();
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (!trainerOpen) setRequested(false);
  }, [trainerOpen]);
  const active = trainerOpen && !isCompactViewport;
  const overTrainer = active && requested && expertPanelVisible;
  return {
    showTopbarButton: active && !overTrainer,
    panelColClass: active ? (overTrainer ? ' is-over-trainer' : ' is-behind-trainer') : '',
    request: () => setRequested(true),
  };
}
