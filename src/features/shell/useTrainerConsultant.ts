import { useEffect, useState } from 'react';
import { useTrainerResultOpen, useTrainerScreenOpen } from '../journey/consultantScreenSuggestion';

/**
 * Макет 14: на 1440 у тренажёра нет колонки консультанта. Пока он открыт, колонка спрятана,
 * а в шапке появляется значок консультанта; по нему панель ложится поверх тренажёра.
 * На итоге (`res`) значка нет, как в макете: «К подготовке» возвращает колонку консультанта.
 */
export function useTrainerConsultant(expertPanelVisible: boolean, isCompactViewport: boolean) {
  const trainerOpen = useTrainerScreenOpen();
  const resultOpen = useTrainerResultOpen();
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (!trainerOpen) setRequested(false);
  }, [trainerOpen]);
  const active = trainerOpen && !isCompactViewport;
  const overTrainer = active && requested && expertPanelVisible;
  return {
    showTopbarButton: active && !overTrainer && !resultOpen,
    panelColClass: active ? (overTrainer ? ' is-over-trainer' : ' is-behind-trainer') : '',
    request: () => setRequested(true),
  };
}
