import { useEffect, useState } from 'react';

const NO_COUNTRY = 'Выберите страну — редактор расходов откроется для неё.';
const NO_SCALE =
  'Для этой страны нет проверенной налоговой шкалы. Выберите другую страну — редактор расходов откроется для неё.';

/**
 * «Уточнить расходы» без страны с проверенной шкалой раньше молчал, а редактор
 * внезапно открывался после выбора страны (26.10). Теперь нажатие просит
 * выбрать страну и ставит на поле фокус; смена страны снимает подсказку.
 */
export function useEconomyCountryPrompt(
  countryCode: string,
  fieldId: string,
): { readonly message: string | null; readonly ask: () => void } {
  const [asked, setAsked] = useState(false);
  useEffect(() => setAsked(false), [countryCode]);
  return {
    message: asked ? (countryCode ? NO_SCALE : NO_COUNTRY) : null,
    ask: () => {
      setAsked(true);
      document.getElementById(fieldId)?.focus();
    },
  };
}
