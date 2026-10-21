import { useEffect, useState } from 'react';
import { getRelocationQuestionnaire } from '../relocation/relocationApi';

/**
 * «Страны и релокация» на «Карьере» показывает то же, что сам раздел: согласие
 * анкеты релокации (B445-r1). Раньше строка читала формат «relocation» из
 * условий поиска и расходилась с разделом после согласия в анкете.
 *
 * `null` — анкета ещё не прочитана или не прочиталась: тогда экран оставляет
 * прежний признак из условий, а не выдумывает состояние.
 */
export function useRelocationConsent(enabled: boolean, revision: number): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getRelocationQuestionnaire(controller.signal)
      .then((read) => setGranted(read.consent.granted))
      .catch(() => {
        if (!controller.signal.aborted) setGranted(null);
      });
    return () => controller.abort();
  }, [enabled, revision]);
  return granted;
}
