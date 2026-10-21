import { useCallback, useState } from 'react';

import { putDecisionProfile } from '../coach/coachApi';
import { loadDecisionProfile, saveDecisionProfile } from '../../../shared/workPreferences';

/**
 * Релокация из условий поиска кандидата (профиль ограничений, B384) для
 * «Других стран» фильтра «Локации» (B547). Кнопка «Включить» добавляет
 * формат «Релокация» в тот же профиль, что правится в «Карьера › условия».
 */
export function useRelocationSetting() {
  const [enabled, setEnabled] = useState(() =>
    loadDecisionProfile().workFormats.includes('relocation'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const enable = useCallback(() => {
    const profile = loadDecisionProfile();
    const next = {
      ...profile,
      workFormats: [...profile.workFormats.filter((id) => id !== 'relocation'), 'relocation' as const],
      updatedAt: new Date().toISOString(),
    };
    saveDecisionProfile(next);
    setEnabled(true);
    setSaving(true);
    setError(undefined);
    putDecisionProfile(next)
      .catch(() =>
        setError('Релокация включена на этом устройстве, но не сохранилась на сервере. Повторите позже.'),
      )
      .finally(() => setSaving(false));
  }, []);
  return { enabled, saving, error, enable };
}
